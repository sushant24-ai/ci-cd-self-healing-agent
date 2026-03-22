import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import nock from 'nock';
import { Octokit } from '@octokit/rest';
import AdmZip from 'adm-zip';
import { fetchFailedJobLogs } from '../../src/github/logs.js';

const owner = 'acme';
const repo = 'webapp';
const runId = 12345;

function createOctokit() {
  return new Octokit({ auth: 'test-token' });
}

let tmpDir: string;
let singleJobZipPath: string;
let multiJobZipPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'heal-zip-'));

  // Create zip fixtures on disk so nock can serve them as binary
  const zip1 = new AdmZip();
  zip1.addFile('build/1_Setup.txt', Buffer.from('Setting up...'));
  zip1.addFile('build/2_Run tests.txt', Buffer.from('Error: test failed\nAssertionError: expected 1 to equal 2'));
  zip1.addFile('lint/1_Run lint.txt', Buffer.from('All checks passed'));
  singleJobZipPath = join(tmpDir, 'single.zip');
  writeFileSync(singleJobZipPath, zip1.toBuffer());

  const zip2 = new AdmZip();
  zip2.addFile('build/1_Compile.txt', Buffer.from('Compile error'));
  zip2.addFile('test/1_Unit tests.txt', Buffer.from('Test error'));
  multiJobZipPath = join(tmpDir, 'multi.zip');
  writeFileSync(multiJobZipPath, zip2.toBuffer());
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('fetchFailedJobLogs', () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('returns empty array when no jobs failed', async () => {
    nock('https://api.github.com')
      .get(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`)
      .query({ filter: 'latest' })
      .reply(200, {
        jobs: [
          { id: 1, name: 'build', conclusion: 'success', steps: [] },
        ],
      });

    const result = await fetchFailedJobLogs(createOctokit(), owner, repo, runId);
    expect(result).toEqual([]);
  });

  it('extracts logs for failed jobs from zip', async () => {
    nock('https://api.github.com')
      .get(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`)
      .query({ filter: 'latest' })
      .reply(200, {
        jobs: [
          {
            id: 101,
            name: 'build',
            conclusion: 'failure',
            steps: [
              { name: 'Setup', conclusion: 'success' },
              { name: 'Run tests', conclusion: 'failure' },
            ],
          },
          {
            id: 102,
            name: 'lint',
            conclusion: 'success',
            steps: [{ name: 'Run lint', conclusion: 'success' }],
          },
        ],
      });

    nock('https://api.github.com')
      .get(`/repos/${owner}/${repo}/actions/runs/${runId}/logs`)
      .replyWithFile(200, singleJobZipPath, { 'Content-Type': 'application/zip' });

    const result = await fetchFailedJobLogs(createOctokit(), owner, repo, runId);

    expect(result).toHaveLength(1);
    expect(result[0].jobId).toBe(101);
    expect(result[0].jobName).toBe('build');
    expect(result[0].stepName).toBe('Run tests');
    expect(result[0].logs).toContain('Setting up...');
    expect(result[0].logs).toContain('Error: test failed');
  });

  it('handles multiple failed jobs', async () => {
    nock('https://api.github.com')
      .get(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`)
      .query({ filter: 'latest' })
      .reply(200, {
        jobs: [
          {
            id: 201,
            name: 'build',
            conclusion: 'failure',
            steps: [{ name: 'Compile', conclusion: 'failure' }],
          },
          {
            id: 202,
            name: 'test',
            conclusion: 'failure',
            steps: [{ name: 'Unit tests', conclusion: 'failure' }],
          },
        ],
      });

    nock('https://api.github.com')
      .get(`/repos/${owner}/${repo}/actions/runs/${runId}/logs`)
      .replyWithFile(200, multiJobZipPath, { 'Content-Type': 'application/zip' });

    const result = await fetchFailedJobLogs(createOctokit(), owner, repo, runId);
    expect(result).toHaveLength(2);
    expect(result[0].jobName).toBe('build');
    expect(result[1].jobName).toBe('test');
  });
});
