import { readFileSync } from 'node:fs';
import { loadConfig } from './config/loader.js';
import { createGitHubClient } from './github/client.js';
import { fetchFailedJobLogs } from './github/logs.js';
import { createFixPR } from './github/pr.js';
import { loadIncidents, writeIncident } from './github/incidents.js';
import { createLLMProvider } from './llm/provider.js';
import { parseLogs } from './analysis/log-parser.js';
import { classifyFailure } from './analysis/classifier.js';
import { generateFix } from './analysis/fixer.js';
import {
  sendTeamsNotification,
  buildCodeFixCard,
  buildNonCodeCard,
} from './notifications/teams.js';
import { parseEvent, buildIncident } from './pipeline.js';
import type { IncidentRecord } from './types.js';

async function main() {
  const configPath = process.env.CONFIG_PATH ?? 'config.yml';
  const config = loadConfig(configPath);

  // ── 1. Parse event ──────────────────────────────────────────
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error('GITHUB_EVENT_PATH not set');
  }

  const rawEvent = JSON.parse(readFileSync(eventPath, 'utf-8'));
  const event = parseEvent(rawEvent);

  console.log(`Processing failure: ${event.owner}/${event.repo} workflow "${event.workflowName}" run #${event.runId}`);

  // ── 2. Check whitelist ──────────────────────────────────────
  const repoConfig = config.repos.find(
    (r) => r.owner === event.owner && r.repo === event.repo,
  );

  if (!repoConfig) {
    console.log(`Repository ${event.owner}/${event.repo} not in whitelist, skipping.`);
    return;
  }

  // ── 3. Init clients ────────────────────────────────────────
  const octokit = createGitHubClient({
    token: process.env.GITHUB_TOKEN,
    appId: process.env.APP_ID ? parseInt(process.env.APP_ID, 10) : undefined,
    privateKey: process.env.APP_PRIVATE_KEY,
    installationId: process.env.INSTALLATION_ID
      ? parseInt(process.env.INSTALLATION_ID, 10)
      : undefined,
  });

  const llm = await createLLMProvider(config.llm);

  // ── 4. Fetch failed job logs ────────────────────────────────
  console.log('Fetching workflow logs...');
  const failedJobs = await fetchFailedJobLogs(octokit, event.owner, event.repo, event.runId);

  if (failedJobs.length === 0) {
    console.log('No failed jobs found.');
    return;
  }

  // Combine and parse logs from all failed jobs
  const combinedLogs = failedJobs.map((j) => `=== ${j.jobName} / ${j.stepName} ===\n${j.logs}`).join('\n\n');
  const parsed = parseLogs(combinedLogs);

  // ── 5. Load past incidents (memory) ─────────────────────────
  console.log('Loading past incidents...');
  const pastIncidents = await loadIncidents(octokit, event.owner, event.repo);

  // ── 6. Classify failure ─────────────────────────────────────
  console.log('Classifying failure...');
  const analysis = await classifyFailure(llm, parsed.cleaned, parsed.errorLines, pastIncidents);
  console.log(`Classification: ${analysis.classification} (confidence: ${analysis.confidence})`);

  const baseBranch = repoConfig.defaultBranch ?? 'main';

  // ── 7. Act on classification ────────────────────────────────
  if (analysis.classification === 'code') {
    console.log('Attempting code fix...');

    // Fetch contents of related files
    const fileContents = new Map<string, string>();
    const repoFiles = new Set<string>();

    for (const filePath of analysis.relatedFiles) {
      try {
        const { data } = await octokit.repos.getContent({
          owner: event.owner,
          repo: event.repo,
          path: filePath,
          ref: baseBranch,
        });
        if ('content' in data && typeof data.content === 'string') {
          const content = Buffer.from(data.content, 'base64').toString('utf-8');
          fileContents.set(filePath, content);
          repoFiles.add(filePath);
        }
      } catch {
        console.warn(`Could not fetch file: ${filePath}`);
      }
    }

    const fixResult = await generateFix(llm, analysis, fileContents, repoFiles, config.safety);

    if (fixResult.success && fixResult.fix) {
      console.log('Creating fix PR...');
      const pr = await createFixPR(
        octokit,
        event.owner,
        event.repo,
        baseBranch,
        fixResult.fix,
        repoConfig.reviewers ?? [],
      );

      console.log(`PR created: ${pr.prUrl}`);
      const resolution = `Auto-fix PR #${pr.prNumber}: ${pr.prUrl}`;

      // Write incident to PR branch
      const incident = buildIncident(event, analysis, 'auto-fixed', resolution, pastIncidents);
      await writeIncident(octokit, event.owner, event.repo, pr.branch, incident);

      // Notify Teams
      if (config.teams.enabled) {
        const card = buildCodeFixCard(event, analysis, pr);
        await sendTeamsNotification(config.teams.webhookUrl, card);
        console.log('Teams notification sent (code fix).');
      }
    } else {
      console.log(`Fix generation failed: ${fixResult.reason}. Falling back to notification.`);
      // Downgrade to non-code path
      await handleNonCode(octokit, config, event, analysis, baseBranch, pastIncidents);
    }
  } else {
    await handleNonCode(octokit, config, event, analysis, baseBranch, pastIncidents);
  }

  console.log('Done.');
}

async function handleNonCode(
  octokit: ReturnType<typeof createGitHubClient>,
  config: ReturnType<typeof loadConfig>,
  event: ReturnType<typeof parseEvent>,
  analysis: Awaited<ReturnType<typeof classifyFailure>>,
  baseBranch: string,
  pastIncidents: IncidentRecord[],
) {
  const incident = buildIncident(event, analysis, 'manual-action-required', analysis.suggestedAction, pastIncidents);

  // Write incident to a dedicated branch
  const incidentBranch = `incident/${Date.now()}`;
  try {
    const { data: refData } = await octokit.git.getRef({
      owner: event.owner,
      repo: event.repo,
      ref: `heads/${baseBranch}`,
    });
    await octokit.git.createRef({
      owner: event.owner,
      repo: event.repo,
      ref: `refs/heads/${incidentBranch}`,
      sha: refData.object.sha,
    });
    await writeIncident(octokit, event.owner, event.repo, incidentBranch, incident);
    console.log(`Incident recorded on branch: ${incidentBranch}`);
  } catch (err) {
    console.warn('Failed to write incident file:', err);
  }

  if (config.teams.enabled) {
    const card = buildNonCodeCard(event, analysis);
    await sendTeamsNotification(config.teams.webhookUrl, card);
    console.log('Teams notification sent (non-code).');
  }
}

main().catch((err) => {
  console.error('Self-healing agent failed:', err);
  process.exit(1);
});
