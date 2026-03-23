/**
 * E2E test runner — exercises the full pipeline against a real GitHub repo
 * with a mock LLM (no API key needed).
 *
 * Usage:
 *   GITHUB_TOKEN=<pat> npx tsx scripts/e2e-test.ts <owner> <repo> <run_id>
 */

import { Octokit } from '@octokit/rest';
import { fetchFailedJobLogs } from '../src/github/logs.js';
import { createFixPR } from '../src/github/pr.js';
import { loadIncidents, writeIncident, buildIncidentFile } from '../src/github/incidents.js';
import { parseLogs } from '../src/analysis/log-parser.js';
import { classifyFailure } from '../src/analysis/classifier.js';
import { generateFix } from '../src/analysis/fixer.js';
import { parseEvent, buildIncident } from '../src/pipeline.js';
import type { LLMProvider, SafetyConfig } from '../src/types.js';

// ── Args ──────────────────────────────────────────────────────
const [owner, repo, runIdStr] = process.argv.slice(2);
if (!owner || !repo || !runIdStr) {
  console.error('Usage: GITHUB_TOKEN=<pat> npx tsx scripts/e2e-test.ts <owner> <repo> <run_id>');
  process.exit(1);
}
const runId = parseInt(runIdStr, 10);
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

// ── Mock LLM ──────────────────────────────────────────────────
// Returns realistic structured responses without calling a real API
const mockLLM: LLMProvider = {
  async analyze(systemPrompt: string, userPrompt: string): Promise<string> {
    // Check if this is a classification or fix request
    if (systemPrompt.includes('classify') || systemPrompt.includes('Classification')) {
      return JSON.stringify({
        classification: 'code',
        confidence: 0.92,
        errorSummary: 'TypeError: Cannot read properties of null (reading \'toISOString\')',
        rootCause: 'The formatDate function in src/utils.js does not handle null/undefined input, causing a TypeError when null is passed.',
        suggestedAction: 'Add a null/undefined guard at the top of formatDate() that returns "Invalid Date" for falsy inputs.',
        relatedFiles: ['src/utils.js'],
      });
    } else {
      // Fix generation
      return JSON.stringify({
        fixes: [{
          path: 'src/utils.js',
          fixedContent: `// Fixed: handle null/undefined input
export function formatDate(date) {
  if (!date) return 'Invalid Date';
  return date.toISOString().split('T')[0];
}

export function add(a, b) {
  return a + b;
}
`,
        }],
        explanation: 'Added a null guard to formatDate() that returns "Invalid Date" for null/undefined inputs instead of throwing a TypeError.',
        prTitle: 'fix: handle null input in formatDate',
        prBody: '## Summary\\n- Added null/undefined check in `formatDate()`\\n- Returns `"Invalid Date"` for falsy inputs\\n\\n## Root Cause\\n`formatDate(null)` called `.toISOString()` on null, causing TypeError.\\n\\nFixes CI failure in Build and Test workflow.',
      });
    }
  },
  async analyzeStructured<T>(systemPrompt: string, userPrompt: string, parse: (raw: string) => T): Promise<T> {
    const raw = await this.analyze(systemPrompt, userPrompt);
    return parse(raw);
  },
};

const safety: SafetyConfig = {
  maxFilesChanged: 5,
  maxLineDelta: 200,
  blockedPaths: ['.env*', 'secrets*', '*.lock'],
  requireReviewers: true,
};

// ── Pipeline ──────────────────────────────────────────────────
async function run() {
  const octokit = new Octokit({ auth: token });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  E2E TEST: ${owner}/${repo} run #${runId}`);
  console.log(`  Using: Mock LLM (no API key needed)`);
  console.log(`${'='.repeat(60)}\n`);

  // Step 1: Fetch failed job logs
  console.log('Step 1: Fetching failed job logs...');
  const failedJobs = await fetchFailedJobLogs(octokit, owner, repo, runId);
  console.log(`  Found ${failedJobs.length} failed job(s):`);
  for (const job of failedJobs) {
    console.log(`    - ${job.jobName} / ${job.stepName} (${job.logs.length} chars)`);
  }

  if (failedJobs.length === 0) {
    console.log('  No failed jobs found. Exiting.');
    return;
  }

  // Step 2: Parse logs
  console.log('\nStep 2: Parsing logs...');
  const combinedLogs = failedJobs.map((j) => `=== ${j.jobName} / ${j.stepName} ===\n${j.logs}`).join('\n\n');
  const parsed = parseLogs(combinedLogs);
  console.log(`  Cleaned log: ${parsed.cleaned.length} chars`);
  console.log(`  Error lines: ${parsed.errorLines.length}`);
  if (parsed.errorLines.length > 0) {
    console.log('  Sample errors:');
    for (const line of parsed.errorLines.slice(0, 5)) {
      console.log(`    > ${line.trim().slice(0, 120)}`);
    }
  }

  // Step 3: Load past incidents
  console.log('\nStep 3: Loading past incidents...');
  const pastIncidents = await loadIncidents(octokit, owner, repo);
  console.log(`  Found ${pastIncidents.length} past incident(s)`);

  // Step 4: Classify (mock LLM)
  console.log('\nStep 4: Classifying failure (mock LLM)...');
  const analysis = await classifyFailure(mockLLM, parsed.cleaned, parsed.errorLines, pastIncidents);
  console.log(`  Classification: ${analysis.classification}`);
  console.log(`  Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
  console.log(`  Error: ${analysis.errorSummary}`);
  console.log(`  Root cause: ${analysis.rootCause}`);
  console.log(`  Related files: ${analysis.relatedFiles.join(', ')}`);

  // Step 5: Generate fix (mock LLM)
  if (analysis.classification === 'code') {
    console.log('\nStep 5: Generating code fix (mock LLM)...');

    // Fetch file contents
    const fileContents = new Map<string, string>();
    const repoFiles = new Set<string>();
    for (const filePath of analysis.relatedFiles) {
      try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: filePath, ref: 'main' });
        if ('content' in data && typeof data.content === 'string') {
          const content = Buffer.from(data.content, 'base64').toString('utf-8');
          fileContents.set(filePath, content);
          repoFiles.add(filePath);
          console.log(`  Fetched: ${filePath} (${content.length} chars)`);
        }
      } catch {
        console.log(`  Could not fetch: ${filePath}`);
      }
    }

    const fixResult = await generateFix(mockLLM, analysis, fileContents, repoFiles, safety);

    if (fixResult.success && fixResult.fix) {
      console.log(`  Fix generated: ${fixResult.fix.fixes.length} file(s)`);
      console.log(`  PR title: ${fixResult.fix.prTitle}`);

      // Step 6: Create PR
      console.log('\nStep 6: Creating fix PR...');
      const pr = await createFixPR(octokit, owner, repo, 'main', fixResult.fix, [owner]);
      console.log(`  PR #${pr.prNumber}: ${pr.prUrl}`);
      console.log(`  Branch: ${pr.branch}`);

      // Step 7: Write incident to PR branch
      console.log('\nStep 7: Recording incident...');
      const event = {
        owner, repo, runId,
        runUrl: `https://github.com/${owner}/${repo}/actions/runs/${runId}`,
        workflowName: 'Build and Test',
        branch: 'main',
        commitSha: '',
        triggeredBy: 'e2e-test',
        failedAt: new Date().toISOString(),
      };

      const incident = buildIncident(event, analysis, 'auto-fixed', `Auto-fix PR #${pr.prNumber}: ${pr.prUrl}`, pastIncidents);
      const incidentPath = await writeIncident(octokit, owner, repo, pr.branch, incident);
      console.log(`  Incident written: ${incidentPath}`);

      console.log(`\n${'='.repeat(60)}`);
      console.log('  E2E TEST PASSED');
      console.log(`  PR created: ${pr.prUrl}`);
      console.log(`  Incident: ${incidentPath}`);
      console.log(`${'='.repeat(60)}\n`);
    } else {
      console.log(`  Fix failed: ${fixResult.reason}`);
      console.log('  Would send Teams notification (disabled for test)');
    }
  } else {
    console.log('\nStep 5: Non-code issue — would send Teams notification');
    console.log(`  Suggested action: ${analysis.suggestedAction}`);
  }
}

run().catch((err) => {
  console.error('\nE2E TEST FAILED:', err);
  process.exit(1);
});
