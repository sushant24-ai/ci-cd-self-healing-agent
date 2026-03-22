# Testing Guide

This document covers every layer of testing for the CI/CD Self-Healing Agent.

---

## 1. Automated Tests (77 tests)

```bash
npm test          # Run all tests
npm run test:watch  # Watch mode
```

### Test Matrix

| Layer | File | Tests | What it covers |
|-------|------|-------|----------------|
| **Unit** | `config.test.ts` | 5 | Zod schema validation, defaults, rejections |
| **Unit** | `config-loader.test.ts` | 3 | `${VAR}` interpolation, missing env vars, invalid YAML |
| **Unit** | `log-parser.test.ts` | 13 | ANSI stripping, timestamp removal, error extraction, truncation |
| **Unit** | `pipeline.test.ts` | 8 | `parseEvent` (3 payload formats), `buildIncident` (related incidents, limits) |
| **Unit** | `teams.test.ts` | 2 | Adaptive Card structure for code-fix and non-code |
| **Unit** | `teams-send.test.ts` | 3 | HTTP POST, error responses, network failures |
| **Unit** | `github-client.test.ts` | 3 | PAT auth, missing credentials, partial App credentials |
| **Unit** | `llm-factory.test.ts` | 5 | Claude/OpenAI/Azure creation, missing endpoint, unknown provider |
| **Unit** | `fixer-safety.test.ts` | 6 | Line delta, blocked paths (.env, secrets), LLM failure |
| **Unit** | `parse-event.test.ts` | 9 | Webhook payload field extraction, dispatch payload shape |
| **Integration** | `classifier.test.ts` | 3 | Code vs non-code, confidence threshold, past incidents in prompt |
| **Integration** | `fixer.test.ts` | 5 | Successful fix, file limit, blocked paths, missing files, empty fix |
| **Integration** | `llm-provider.test.ts` | 3 | Retry logic: success, retry+succeed, exhaust retries |
| **Integration** | `github-api.test.ts` | 3 | Load incidents (404, parse), build incident file path |
| **Integration** | `github-pr.test.ts` | 2 | Full 7-step Git Tree API flow, skip reviewers when empty |
| **Integration** | `github-logs.test.ts` | 3 | No failed jobs, zip extraction, multiple failed jobs |
| **Integration** | `github-incidents-write.test.ts` | 1 | Write incident via GitHub API with correct base64 content |

---

## 2. Manual Testing via workflow_dispatch

The easiest way to test the full pipeline without setting up webhooks.

### Prerequisites
- Secrets configured on the central repo (see README.md)
- A target repo with a **failed** workflow run

### Steps

```bash
# 1. Find a failed run ID in the target repo
gh run list -R <owner>/<repo> --status failure --limit 5

# 2. Trigger the heal agent manually
gh workflow run heal.yml \
  -R <your-org>/ci-cd-self-healing-agent \
  -f owner=<owner> \
  -f repo=<repo> \
  -f run_id=<RUN_ID>

# 3. Watch the workflow
gh run watch -R <your-org>/ci-cd-self-healing-agent

# 4. Check results
# For code issues: look for a new PR in the target repo
gh pr list -R <owner>/<repo>

# For non-code issues: check Teams channel for notification
# For both: check .github/incidents/ for new files
```

---

## 3. End-to-End Test with a Deliberate Bug

### Automated setup

```bash
# Creates a test repo with a failing CI workflow
chmod +x scripts/setup-test-repo.sh
./scripts/setup-test-repo.sh <your-github-username>
```

This creates `heal-test-target` with:
- `src/utils.js` — has a bug: `formatDate(null)` throws TypeError
- `src/utils.test.js` — test that triggers the bug
- `.github/workflows/ci.yml` — CI that runs `npm test`

### Manual E2E walkthrough

```bash
# 1. Wait for CI to fail, then get the run ID
gh run list -R <user>/heal-test-target --status failure

# 2. Update config.yml in the agent repo to whitelist the test repo
#    repos:
#      - owner: <user>
#        repo: heal-test-target
#        reviewers: [<user>]

# 3. Trigger the agent
gh workflow run heal.yml \
  -f owner=<user> \
  -f repo=heal-test-target \
  -f run_id=<RUN_ID>

# 4. Verify the agent:
#    a. Fetched and parsed the CI logs
#    b. Classified as "code" (TypeError in source file)
#    c. Created a fix PR with null check in src/utils.js
#    d. Sent Teams notification (if configured)
#    e. Wrote incident file to .github/incidents/

# 5. Check the PR
gh pr list -R <user>/heal-test-target
gh pr view <PR_NUMBER> -R <user>/heal-test-target
```

### Expected PR content
The agent should create a PR that adds a null/undefined guard to `formatDate`:
```js
export function formatDate(date) {
  if (!date) return 'Invalid Date';
  return date.toISOString().split('T')[0];
}
```

---

## 4. Safety Tests

These verify the agent's guardrails work correctly.

### Test: Fix exceeds file limit
1. Create a failure that would require fixing 6+ files
2. Agent should **fall back to Teams notification** instead of creating a PR
3. Verified in: `fixer.test.ts` → "fails when fix exceeds maxFilesChanged"

### Test: Fix touches blocked path
1. Craft a failure where the LLM suggests modifying `.env` or lock files
2. Agent should **reject the fix** and send notification instead
3. Verified in: `fixer-safety.test.ts` → "blocks .env.production", "blocks secrets"

### Test: Low confidence classification
1. Ambiguous failure log that could be code or infra
2. Agent should **default to non-code** when confidence < 0.6
3. Verified in: `classifier.test.ts` → "downgrades low-confidence"

### Test: LLM failure
1. LLM API returns error or invalid JSON
2. Agent should **retry up to 2 times**, then fall back to notification
3. Verified in: `llm-provider.test.ts` → "throws after exhausting retries"

### Manual safety test
```bash
# Create a test repo where the failure is infrastructure (e.g., OOM, timeout)
# The agent should:
#   - Classify as "non-code"
#   - NOT create a PR
#   - Send Teams notification with diagnosis
#   - Write incident as "manual-action-required"
```

---

## 5. Specific Scenarios to Test

### Scenario A: Simple test failure (code)
- **Input**: Test fails due to TypeError / assertion error
- **Expected**: Agent creates PR with targeted fix
- **Verify**: PR has minimal changes, incident recorded

### Scenario B: Build failure — missing import (code)
- **Input**: `Cannot find module './newFile'`
- **Expected**: Agent identifies missing import, but may not create the file (safety: non-existent path)
- **Verify**: Falls back to notification if file doesn't exist

### Scenario C: npm install failure (non-code)
- **Input**: `npm ERR! 404 Not Found`
- **Expected**: Classified as non-code, Teams notification sent
- **Verify**: No PR created, incident has "manual-action-required"

### Scenario D: Flaky test / timeout (non-code)
- **Input**: `Error: Timeout of 5000ms exceeded`
- **Expected**: Non-code classification, notification only
- **Verify**: Suggested action mentions retrying or increasing timeout

### Scenario E: Docker pull failure (non-code)
- **Input**: `Error response from daemon: pull access denied`
- **Expected**: Non-code, notification with infra diagnosis

### Scenario F: Duplicate failure (memory test)
- **Input**: Same failure as a previous run
- **Expected**: Agent loads past incident from `.github/incidents/`, mentions it in analysis
- **Verify**: New incident's "Related Past Incidents" section references the old one

---

## 6. Testing the Webhook Relay (Production)

For full production testing with automatic triggers:

1. **Deploy webhook relay** (Cloudflare Worker / Azure Function)
2. **Configure GitHub App** webhook URL to point to the relay
3. **Install App** on the test repo
4. **Push a failing commit** to the test repo
5. **Verify chain**: webhook → relay → `repository_dispatch` → heal.yml → agent runs

### Relay validation checklist
- [ ] HMAC signature verified
- [ ] Only `workflow_run` events with `conclusion: failure` forwarded
- [ ] `repository_dispatch` reaches the central repo
- [ ] Concurrency group prevents duplicate heals

---

## 7. Debugging Failed Runs

```bash
# View agent workflow logs
gh run view <RUN_ID> -R <org>/ci-cd-self-healing-agent --log

# Check specific job step
gh run view <RUN_ID> -R <org>/ci-cd-self-healing-agent --log | grep -A 50 "Run self-healing"

# List incidents written to a repo
gh api repos/<owner>/<repo>/contents/.github/incidents | jq '.[].name'

# Read a specific incident
gh api repos/<owner>/<repo>/contents/.github/incidents/<filename> | jq -r '.content' | base64 -d
```

---

## 8. Test Coverage Report

```bash
npx vitest run --coverage
```

Currently tested modules:

| Module | Coverage |
|--------|----------|
| `config/schema.ts` | Full |
| `config/loader.ts` | Full (including env interpolation) |
| `analysis/log-parser.ts` | Full |
| `analysis/classifier.ts` | Full (including confidence threshold) |
| `analysis/fixer.ts` | Full (all safety guards) |
| `github/client.ts` | Full (PAT, errors) |
| `github/logs.ts` | Full (zip extraction) |
| `github/pr.ts` | Full (7-step flow) |
| `github/incidents.ts` | Full (read, write, parse) |
| `llm/provider.ts` | Full (factory + retry) |
| `llm/claude.ts` | Constructor only (API calls need real key) |
| `llm/openai.ts` | Constructor only |
| `llm/azure-openai.ts` | Constructor + endpoint validation |
| `notifications/teams.ts` | Full (build + send) |
| `pipeline.ts` | Full (parseEvent + buildIncident) |
| `index.ts` | Not tested directly (tested via components) |
