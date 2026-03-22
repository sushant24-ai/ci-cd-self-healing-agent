import type { WorkflowFailureEvent, IncidentRecord } from './types.js';

/**
 * Parse a GitHub webhook/dispatch payload into a WorkflowFailureEvent.
 * Supports both repository_dispatch (client_payload) and workflow_dispatch formats.
 */
export function parseEvent(raw: Record<string, unknown>): WorkflowFailureEvent {
  // Support both repository_dispatch (client_payload) and workflow_dispatch (inputs)
  const payload = (raw.client_payload as Record<string, unknown>) ?? raw;
  const workflowRun = (payload.workflow_run ?? payload) as Record<string, unknown>;
  const repository = (payload.repository ?? raw.repository) as Record<string, unknown>;
  const repoOwner = repository?.owner as Record<string, unknown>;

  return {
    owner: (repoOwner?.login as string) ?? (payload.owner as string) ?? '',
    repo: (repository?.name as string) ?? (payload.repo as string) ?? '',
    runId: (workflowRun.id as number) ?? (payload.run_id as number) ?? 0,
    runUrl:
      (workflowRun.html_url as string) ??
      `https://github.com/${repoOwner?.login}/${repository?.name}/actions/runs/${workflowRun.id}`,
    workflowName: (workflowRun.name as string) ?? 'Unknown',
    branch: (workflowRun.head_branch as string) ?? 'main',
    commitSha: (workflowRun.head_sha as string) ?? '',
    triggeredBy:
      ((workflowRun.triggering_actor as Record<string, unknown>)?.login as string) ?? 'unknown',
    failedAt: (workflowRun.run_started_at as string) ?? new Date().toISOString(),
  };
}

/**
 * Build an IncidentRecord from event + analysis data.
 */
export function buildIncident(
  event: WorkflowFailureEvent,
  analysis: { errorSummary: string; rootCause: string; classification: 'code' | 'non-code' },
  status: IncidentRecord['status'],
  resolution: string,
  pastIncidents: IncidentRecord[],
): IncidentRecord {
  // Find related past incidents (same workflow or similar error)
  const related = pastIncidents
    .filter(
      (p) =>
        p.workflow === event.workflowName ||
        p.errorSummary.toLowerCase().includes(analysis.errorSummary.slice(0, 20).toLowerCase()),
    )
    .slice(0, 3)
    .map((p) => `[${p.date}] ${p.workflow} run #${p.runId}: ${p.errorSummary}`);

  return {
    date: new Date().toISOString(),
    repository: `${event.owner}/${event.repo}`,
    workflow: event.workflowName,
    runId: event.runId,
    runUrl: event.runUrl,
    classification: analysis.classification,
    status,
    errorSummary: analysis.errorSummary,
    rootCause: analysis.rootCause,
    resolution,
    relatedPastIncidents: related,
  };
}
