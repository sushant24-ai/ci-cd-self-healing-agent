import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEvent, buildIncident } from '../../src/pipeline.js';
import type { WorkflowFailureEvent, IncidentRecord } from '../../src/types.js';

describe('parseEvent', () => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'fixtures', 'webhook-payload.json'), 'utf-8'),
  );

  it('parses a full workflow_run webhook payload', () => {
    const event = parseEvent(fixture);
    expect(event.owner).toBe('acme');
    expect(event.repo).toBe('webapp');
    expect(event.runId).toBe(12345);
    expect(event.workflowName).toBe('Build and Test');
    expect(event.branch).toBe('main');
    expect(event.commitSha).toBe('abc123def456');
    expect(event.triggeredBy).toBe('developer');
    expect(event.runUrl).toContain('actions/runs/12345');
  });

  it('parses repository_dispatch with client_payload wrapper', () => {
    const dispatchPayload = {
      client_payload: fixture,
    };
    const event = parseEvent(dispatchPayload);
    expect(event.owner).toBe('acme');
    expect(event.repo).toBe('webapp');
    expect(event.runId).toBe(12345);
  });

  it('parses minimal workflow_dispatch payload', () => {
    const event = parseEvent({
      repository: {
        owner: { login: 'myorg' },
        name: 'myrepo',
      },
      workflow_run: {
        id: 99999,
      },
    });
    expect(event.owner).toBe('myorg');
    expect(event.repo).toBe('myrepo');
    expect(event.runId).toBe(99999);
    expect(event.workflowName).toBe('Unknown');
    expect(event.branch).toBe('main');
    expect(event.triggeredBy).toBe('unknown');
  });

  it('handles completely empty payload gracefully', () => {
    const event = parseEvent({});
    expect(event.owner).toBe('');
    expect(event.repo).toBe('');
    expect(event.runId).toBe(0);
  });
});

describe('buildIncident', () => {
  const event: WorkflowFailureEvent = {
    owner: 'acme',
    repo: 'webapp',
    runId: 12345,
    runUrl: 'https://github.com/acme/webapp/actions/runs/12345',
    workflowName: 'Build and Test',
    branch: 'main',
    commitSha: 'abc123',
    triggeredBy: 'dev',
    failedAt: '2026-03-22T14:00:00Z',
  };

  const analysis = {
    classification: 'code' as const,
    errorSummary: 'TypeError in formatDate',
    rootCause: 'Null input not handled',
  };

  it('builds incident with correct fields', () => {
    const incident = buildIncident(event, analysis, 'auto-fixed', 'PR #42', []);
    expect(incident.repository).toBe('acme/webapp');
    expect(incident.workflow).toBe('Build and Test');
    expect(incident.runId).toBe(12345);
    expect(incident.classification).toBe('code');
    expect(incident.status).toBe('auto-fixed');
    expect(incident.resolution).toBe('PR #42');
    expect(incident.relatedPastIncidents).toEqual([]);
  });

  it('finds related past incidents by workflow name', () => {
    const pastIncidents: IncidentRecord[] = [
      {
        date: '2026-03-21T10:00:00Z',
        repository: 'acme/webapp',
        workflow: 'Build and Test', // Same workflow
        runId: 100,
        runUrl: 'https://example.com',
        classification: 'code',
        status: 'auto-fixed',
        errorSummary: 'Different error',
        rootCause: 'Different cause',
        resolution: 'Fixed',
        relatedPastIncidents: [],
      },
      {
        date: '2026-03-20T10:00:00Z',
        repository: 'acme/webapp',
        workflow: 'Deploy', // Different workflow
        runId: 99,
        runUrl: 'https://example.com',
        classification: 'non-code',
        status: 'manual-action-required',
        errorSummary: 'Timeout',
        rootCause: 'Network',
        resolution: 'Retried',
        relatedPastIncidents: [],
      },
    ];

    const incident = buildIncident(event, analysis, 'auto-fixed', 'PR #42', pastIncidents);
    expect(incident.relatedPastIncidents).toHaveLength(1);
    expect(incident.relatedPastIncidents[0]).toContain('Build and Test');
    expect(incident.relatedPastIncidents[0]).toContain('#100');
  });

  it('finds related past incidents by similar error summary', () => {
    const pastIncidents: IncidentRecord[] = [
      {
        date: '2026-03-19T10:00:00Z',
        repository: 'acme/webapp',
        workflow: 'Other Workflow',
        runId: 50,
        runUrl: 'https://example.com',
        classification: 'code',
        status: 'auto-fixed',
        errorSummary: 'TypeError in formatDate — different variant',
        rootCause: 'Similar issue',
        resolution: 'Fixed',
        relatedPastIncidents: [],
      },
    ];

    const incident = buildIncident(event, analysis, 'auto-fixed', 'PR #42', pastIncidents);
    expect(incident.relatedPastIncidents).toHaveLength(1);
    expect(incident.relatedPastIncidents[0]).toContain('#50');
  });

  it('limits related incidents to 3', () => {
    const pastIncidents: IncidentRecord[] = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-03-${10 + i}T10:00:00Z`,
      repository: 'acme/webapp',
      workflow: 'Build and Test',
      runId: i,
      runUrl: 'https://example.com',
      classification: 'code' as const,
      status: 'auto-fixed' as const,
      errorSummary: 'Error',
      rootCause: 'Cause',
      resolution: 'Fixed',
      relatedPastIncidents: [],
    }));

    const incident = buildIncident(event, analysis, 'auto-fixed', 'PR #42', pastIncidents);
    expect(incident.relatedPastIncidents).toHaveLength(3);
  });
});
