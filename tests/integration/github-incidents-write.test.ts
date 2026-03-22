import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { Octokit } from '@octokit/rest';
import { writeIncident } from '../../src/github/incidents.js';
import type { IncidentRecord } from '../../src/types.js';

const owner = 'acme';
const repo = 'webapp';

function createOctokit() {
  return new Octokit({ auth: 'test-token' });
}

const incident: IncidentRecord = {
  date: '2026-03-22T14:30:00Z',
  repository: 'acme/webapp',
  workflow: 'Build and Test',
  runId: 12345,
  runUrl: 'https://github.com/acme/webapp/actions/runs/12345',
  classification: 'code',
  status: 'auto-fixed',
  errorSummary: 'TypeError in formatDate',
  rootCause: 'Missing null check',
  resolution: 'Auto-fix PR #42',
  relatedPastIncidents: ['[2026-03-21] Build run #100: Previous error'],
};

describe('writeIncident', () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('creates incident file via GitHub API', async () => {
    nock('https://api.github.com')
      .put(/\/repos\/acme\/webapp\/contents\/\.github%2Fincidents%2F.*\.md/, (body: any) => {
        // Verify the content is base64-encoded markdown
        const decoded = Buffer.from(body.content, 'base64').toString('utf-8');
        expect(decoded).toContain('# CI Incident: Build and Test');
        expect(decoded).toContain('| Classification | code |');
        expect(decoded).toContain('TypeError in formatDate');
        expect(decoded).toContain('Auto-fix PR #42');
        expect(decoded).toContain('Previous error');
        expect(body.branch).toBe('auto-fix/test-branch');
        expect(body.message).toContain('record CI incident');
        return true;
      })
      .reply(201, { content: { path: '.github/incidents/2026-03-22-abcd1234.md' } });

    const path = await writeIncident(
      createOctokit(),
      owner,
      repo,
      'auto-fix/test-branch',
      incident,
    );

    expect(path).toMatch(/^\.github\/incidents\/2026-03-22-[a-f0-9]{8}\.md$/);
  });
});
