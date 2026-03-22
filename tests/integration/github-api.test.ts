import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { Octokit } from '@octokit/rest';
import { loadIncidents, buildIncidentFile } from '../../src/github/incidents.js';
import type { IncidentRecord } from '../../src/types.js';

const owner = 'acme';
const repo = 'webapp';

function createOctokit() {
  return new Octokit({ auth: 'test-token' });
}

describe('GitHub incidents', () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('returns empty array when incidents directory does not exist', async () => {
    nock('https://api.github.com')
      .get(`/repos/${owner}/${repo}/contents/${encodeURIComponent('.github/incidents')}`)
      .reply(404, { message: 'Not Found' });

    const incidents = await loadIncidents(createOctokit(), owner, repo);
    expect(incidents).toEqual([]);
  });

  it('loads and parses incident files from the repo', async () => {
    const incidentContent = `# CI Incident: Build and Test

| Field | Value |
|-------|-------|
| Date | 2026-03-21T10:00:00Z |
| Repository | acme/webapp |
| Workflow | Build and Test |
| Run | [#100](https://github.com/acme/webapp/actions/runs/100) |
| Classification | code |
| Status | auto-fixed |

## Error Summary
TypeError in formatDate

## Root Cause Analysis
Null input not handled

## Resolution
Added null check

## Related Past Incidents
None`;

    nock('https://api.github.com')
      .get(`/repos/${owner}/${repo}/contents/${encodeURIComponent('.github/incidents')}`)
      .reply(200, [
        {
          name: '2026-03-21-abcd1234.md',
          path: '.github/incidents/2026-03-21-abcd1234.md',
          type: 'file',
        },
      ]);

    nock('https://api.github.com')
      .get(`/repos/${owner}/${repo}/contents/${encodeURIComponent('.github/incidents/2026-03-21-abcd1234.md')}`)
      .reply(200, {
        content: Buffer.from(incidentContent).toString('base64'),
        encoding: 'base64',
      });

    const incidents = await loadIncidents(createOctokit(), owner, repo);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].workflow).toBe('Build and Test');
    expect(incidents[0].classification).toBe('code');
    expect(incidents[0].runId).toBe(100);
  });

  it('builds incident file with correct path format', () => {
    const incident: IncidentRecord = {
      date: '2026-03-22T14:30:00Z',
      repository: 'acme/webapp',
      workflow: 'Build and Test',
      runId: 12345,
      runUrl: 'https://github.com/acme/webapp/actions/runs/12345',
      classification: 'code',
      status: 'auto-fixed',
      errorSummary: 'TypeError',
      rootCause: 'Missing null check',
      resolution: 'Added null check',
      relatedPastIncidents: [],
    };

    const { path, content } = buildIncidentFile(incident);
    expect(path).toMatch(/^\.github\/incidents\/2026-03-22-[a-f0-9]{8}\.md$/);
    expect(content).toContain('# CI Incident: Build and Test');
    expect(content).toContain('| Classification | code |');
  });
});
