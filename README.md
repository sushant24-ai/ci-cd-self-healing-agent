# CI/CD Self-Healing Agent

A GitHub-based system that automatically detects CI/CD workflow failures, analyzes logs with an LLM, and either creates fix PRs (code issues) or notifies Teams (non-code issues). Each incident is recorded as a `.md` file in the failing repo, building an agent memory for future debugging.

## How It Works

```
GitHub App webhook (workflow_run failure)
  → repository_dispatch to this central repo
    → heal.yml workflow runs
      → 1. Parse event, check repo whitelist
      → 2. Fetch failed job logs via GitHub API
      → 3. Strip noise (ANSI, timestamps), extract errors
      → 4. Load past incidents from .github/incidents/ (memory)
      → 5. Send to LLM → classify: code vs non-code
      → 6a. CODE: generate fix → create branch + PR → notify Teams
      → 6b. NON-CODE: notify Teams with diagnosis + recommended action
      → 7. Write incident .md to repo
```

## Setup

### 1. Create a GitHub App

Create a GitHub App with these permissions:

| Permission | Access |
|-----------|--------|
| Actions | Read |
| Checks | Read |
| Contents | Write |
| Pull Requests | Write |
| Metadata | Read |

Subscribe to the `workflow_run` event.

### 2. Install the App

Install the GitHub App on the repositories you want to monitor.

### 3. Configure Secrets

Add these secrets to the central repo:

| Secret | Description |
|--------|-------------|
| `HEAL_GITHUB_TOKEN` | PAT or App installation token |
| `APP_ID` | GitHub App ID |
| `APP_PRIVATE_KEY` | GitHub App private key |
| `INSTALLATION_ID` | App installation ID |
| `ANTHROPIC_API_KEY` | Claude API key (if using Claude) |
| `OPENAI_API_KEY` | OpenAI API key (if using OpenAI) |
| `TEAMS_WEBHOOK_URL` | Teams Incoming Webhook URL |

### 4. Configure `config.yml`

```yaml
repos:
  - owner: your-org
    repo: your-repo
    reviewers:
      - reviewer1
    defaultBranch: main

llm:
  provider: claude              # claude | openai | azure-openai
  model: claude-sonnet-4-20250514
  apiKey: ${ANTHROPIC_API_KEY}  # env var interpolation
  maxTokens: 4096

teams:
  webhookUrl: ${TEAMS_WEBHOOK_URL}
  enabled: true

safety:
  maxFilesChanged: 5
  maxLineDelta: 200
  blockedPaths: [".env*", "secrets*", "*.lock"]
  requireReviewers: true
```

### 5. Webhook Relay (Production)

For production, set up a lightweight relay (Cloudflare Worker / Azure Function) that:
1. Receives the GitHub App `workflow_run` webhook
2. Validates the HMAC signature
3. Filters for `conclusion: failure`
4. Sends a `repository_dispatch` to this central repo

For testing, use `workflow_dispatch` with manual inputs.

## Testing

### Manual Test via workflow_dispatch

```bash
gh workflow run heal.yml \
  -f owner=your-org \
  -f repo=your-repo \
  -f run_id=12345
```

### Run Unit & Integration Tests

```bash
npm test
```

## Safety Guards

- Max 5 files changed per PR
- Max 200 line delta per PR
- Blocked paths: `.env*`, `secrets*`, lock files
- All file paths verified to exist in repo before committing
- Never auto-merges — always creates a PR with reviewer requests
- Low confidence (< 60%) → defaults to non-code notification only
- Fix generation failure → falls back to Teams notification

## Incident Memory

Each incident creates a `.github/incidents/YYYY-MM-DD-<hash>.md` file:

```markdown
# CI Incident: <workflow name>
| Field | Value |
|-------|-------|
| Date | ... |
| Repository | owner/repo |
| Workflow | Build and Test |
| Run | [#12345](url) |
| Classification | code / non-code |
| Status | auto-fixed / manual-action-required |

## Error Summary
## Root Cause Analysis
## Resolution
## Related Past Incidents
```

Past incidents are loaded as context for the LLM on each new failure, enabling pattern recognition across incidents.

## Project Structure

```
src/
├── index.ts                  # Orchestrator pipeline
├── types.ts                  # Shared interfaces
├── config/
│   ├── schema.ts             # Zod validation
│   └── loader.ts             # YAML + env var interpolation
├── github/
│   ├── client.ts             # Octokit wrapper
│   ├── logs.ts               # Fetch + extract workflow logs
│   ├── pr.ts                 # Branch + commit + PR creation
│   └── incidents.ts          # Read/write incident files
├── llm/
│   ├── provider.ts           # Interface + factory
│   ├── claude.ts             # Anthropic SDK
│   ├── openai.ts             # OpenAI SDK
│   └── azure-openai.ts       # Azure OpenAI
├── analysis/
│   ├── log-parser.ts         # CI log cleaning + extraction
│   ├── classifier.ts         # Code vs non-code classification
│   └── fixer.ts              # Code fix generation
└── notifications/
    └── teams.ts              # Teams Adaptive Cards
```

## LLM Providers

| Provider | Config Key | Notes |
|----------|-----------|-------|
| Claude | `claude` | Uses `@anthropic-ai/sdk` |
| OpenAI | `openai` | Uses `openai` SDK |
| Azure OpenAI | `azure-openai` | Requires `endpoint` + `apiVersion` |
