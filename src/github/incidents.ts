import { createHash } from 'node:crypto';
import type { Octokit } from '@octokit/rest';
import type { IncidentRecord } from '../types.js';

const INCIDENTS_DIR = '.github/incidents';

/**
 * Read past incident records from the repo's .github/incidents/ directory.
 */
export async function loadIncidents(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<IncidentRecord[]> {
  try {
    const { data: contents } = await octokit.repos.getContent({
      owner,
      repo,
      path: INCIDENTS_DIR,
    });

    if (!Array.isArray(contents)) return [];

    const incidents: IncidentRecord[] = [];

    for (const file of contents) {
      if (!file.name.endsWith('.md') || file.type !== 'file') continue;

      try {
        const { data: fileData } = await octokit.repos.getContent({
          owner,
          repo,
          path: file.path,
        });

        if ('content' in fileData && typeof fileData.content === 'string') {
          const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
          const parsed = parseIncidentMarkdown(content);
          if (parsed) incidents.push(parsed);
        }
      } catch {
        // Skip malformed files
      }
    }

    return incidents;
  } catch {
    // Directory doesn't exist yet — no incidents
    return [];
  }
}

/**
 * Write a new incident record as a .md file.
 * Returns the file path and content for committing.
 */
export function buildIncidentFile(incident: IncidentRecord): { path: string; content: string } {
  const dateStr = incident.date.slice(0, 10); // YYYY-MM-DD
  const hash = createHash('sha256')
    .update(`${incident.runId}-${incident.date}`)
    .digest('hex')
    .slice(0, 8);

  const path = `${INCIDENTS_DIR}/${dateStr}-${hash}.md`;
  const content = formatIncidentMarkdown(incident);

  return { path, content };
}

/**
 * Commit an incident file to the repo (on a given branch or default).
 */
export async function writeIncident(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  incident: IncidentRecord,
): Promise<string> {
  const { path, content } = buildIncidentFile(incident);

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: `chore: record CI incident for ${incident.workflow} run #${incident.runId}`,
    content: Buffer.from(content).toString('base64'),
    branch,
  });

  return path;
}

function formatIncidentMarkdown(inc: IncidentRecord): string {
  return `# CI Incident: ${inc.workflow}

| Field | Value |
|-------|-------|
| Date | ${inc.date} |
| Repository | ${inc.repository} |
| Workflow | ${inc.workflow} |
| Run | [#${inc.runId}](${inc.runUrl}) |
| Classification | ${inc.classification} |
| Status | ${inc.status} |

## Error Summary
${inc.errorSummary}

## Root Cause Analysis
${inc.rootCause}

## Resolution
${inc.resolution}

## Related Past Incidents
${inc.relatedPastIncidents.length > 0 ? inc.relatedPastIncidents.join('\n') : 'None'}
`;
}

function parseIncidentMarkdown(content: string): IncidentRecord | null {
  try {
    const getField = (name: string): string => {
      const re = new RegExp(`\\| ${name} \\| (.+?) \\|`);
      return content.match(re)?.[1]?.trim() ?? '';
    };

    const getSection = (header: string): string => {
      const re = new RegExp(`## ${header}\\n([\\s\\S]*?)(?=\\n## |$)`);
      return content.match(re)?.[1]?.trim() ?? '';
    };

    const runMatch = getField('Run').match(/\[#(\d+)\]\((.+?)\)/);
    const classification = getField('Classification');

    if (!runMatch || (classification !== 'code' && classification !== 'non-code')) {
      return null;
    }

    const relatedRaw = getSection('Related Past Incidents');

    return {
      date: getField('Date'),
      repository: getField('Repository'),
      workflow: getField('Workflow'),
      runId: parseInt(runMatch[1], 10),
      runUrl: runMatch[2],
      classification,
      status: getField('Status') as IncidentRecord['status'],
      errorSummary: getSection('Error Summary'),
      rootCause: getSection('Root Cause Analysis'),
      resolution: getSection('Resolution'),
      relatedPastIncidents: relatedRaw === 'None' ? [] : relatedRaw.split('\n').filter(Boolean),
    };
  } catch {
    return null;
  }
}
