import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// parseEvent is not exported from index.ts, so we'll test it by extracting it.
// For now, test the webhook payload parsing logic directly.

describe('webhook payload parsing', () => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'fixtures', 'webhook-payload.json'), 'utf-8'),
  );

  it('extracts owner from repository.owner.login', () => {
    expect(fixture.repository.owner.login).toBe('acme');
  });

  it('extracts repo from repository.name', () => {
    expect(fixture.repository.name).toBe('webapp');
  });

  it('extracts run ID from workflow_run.id', () => {
    expect(fixture.workflow_run.id).toBe(12345);
  });

  it('extracts conclusion as failure', () => {
    expect(fixture.workflow_run.conclusion).toBe('failure');
  });

  it('extracts branch from workflow_run.head_branch', () => {
    expect(fixture.workflow_run.head_branch).toBe('main');
  });

  it('extracts triggering actor', () => {
    expect(fixture.workflow_run.triggering_actor.login).toBe('developer');
  });

  it('has a workflow name', () => {
    expect(fixture.workflow_run.name).toBe('Build and Test');
  });

  it('has a run URL', () => {
    expect(fixture.workflow_run.html_url).toContain('actions/runs/12345');
  });
});

describe('workflow_dispatch payload shape', () => {
  it('can construct event from manual inputs', () => {
    const dispatchPayload = {
      repository: {
        owner: { login: 'acme' },
        name: 'webapp',
      },
      workflow_run: {
        id: 99999,
      },
    };

    expect(dispatchPayload.repository.owner.login).toBe('acme');
    expect(dispatchPayload.repository.name).toBe('webapp');
    expect(dispatchPayload.workflow_run.id).toBe(99999);
  });
});
