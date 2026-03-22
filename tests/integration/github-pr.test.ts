import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { Octokit } from '@octokit/rest';
import { createFixPR } from '../../src/github/pr.js';
import type { CodeFix } from '../../src/types.js';

const owner = 'acme';
const repo = 'webapp';

function createOctokit() {
  return new Octokit({ auth: 'test-token' });
}

const mockFix: CodeFix = {
  fixes: [
    {
      path: 'src/utils.ts',
      originalContent: 'const x = null.toString();',
      fixedContent: 'const x = null?.toString() ?? "";',
    },
  ],
  explanation: 'Added optional chaining and nullish coalescing',
  prTitle: 'fix: handle null in utils',
  prBody: 'Fixes TypeError when value is null',
};

describe('createFixPR', () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('creates branch, commits, and opens PR with full Git Tree API flow', async () => {
    const baseSha = 'aaa111';
    const treeSha = 'bbb222';
    const newTreeSha = 'ccc333';
    const newCommitSha = 'ddd444';

    const api = nock('https://api.github.com');

    // 1. Get base branch ref
    api.get(`/repos/${owner}/${repo}/git/ref/heads%2Fmain`).reply(200, {
      object: { sha: baseSha },
    });

    // 2. Get base commit tree
    api.get(`/repos/${owner}/${repo}/git/commits/${baseSha}`).reply(200, {
      tree: { sha: treeSha },
    });

    // 3. Create new tree
    api.post(`/repos/${owner}/${repo}/git/trees`, (body: any) => {
      expect(body.base_tree).toBe(treeSha);
      expect(body.tree).toHaveLength(1);
      expect(body.tree[0].path).toBe('src/utils.ts');
      expect(body.tree[0].content).toBe('const x = null?.toString() ?? "";');
      return true;
    }).reply(201, { sha: newTreeSha });

    // 4. Create commit
    api.post(`/repos/${owner}/${repo}/git/commits`, (body: any) => {
      expect(body.tree).toBe(newTreeSha);
      expect(body.parents).toEqual([baseSha]);
      expect(body.message).toContain('fix: handle null in utils');
      return true;
    }).reply(201, { sha: newCommitSha });

    // 5. Create branch ref
    api.post(`/repos/${owner}/${repo}/git/refs`, (body: any) => {
      expect(body.ref).toMatch(/^refs\/heads\/auto-fix\//);
      expect(body.sha).toBe(newCommitSha);
      return true;
    }).reply(201, {});

    // 6. Create PR
    api.post(`/repos/${owner}/${repo}/pulls`, (body: any) => {
      expect(body.title).toBe('fix: handle null in utils');
      expect(body.base).toBe('main');
      expect(body.body).toContain('auto-generated');
      return true;
    }).reply(201, {
      number: 42,
      html_url: `https://github.com/${owner}/${repo}/pull/42`,
    });

    // 7. Request reviewers
    api.post(`/repos/${owner}/${repo}/pulls/42/requested_reviewers`, (body: any) => {
      expect(body.reviewers).toEqual(['alice', 'bob']);
      return true;
    }).reply(200, {});

    const result = await createFixPR(
      createOctokit(),
      owner,
      repo,
      'main',
      mockFix,
      ['alice', 'bob'],
    );

    expect(result.prNumber).toBe(42);
    expect(result.prUrl).toContain('/pull/42');
    expect(result.branch).toMatch(/^auto-fix\//);
    expect(api.isDone()).toBe(true);
  });

  it('skips reviewer request when reviewers list is empty', async () => {
    const api = nock('https://api.github.com');

    api.get(`/repos/${owner}/${repo}/git/ref/heads%2Fmain`).reply(200, {
      object: { sha: 'sha1' },
    });
    api.get(`/repos/${owner}/${repo}/git/commits/sha1`).reply(200, {
      tree: { sha: 'tree1' },
    });
    api.post(`/repos/${owner}/${repo}/git/trees`).reply(201, { sha: 'newtree' });
    api.post(`/repos/${owner}/${repo}/git/commits`).reply(201, { sha: 'newcommit' });
    api.post(`/repos/${owner}/${repo}/git/refs`).reply(201, {});
    api.post(`/repos/${owner}/${repo}/pulls`).reply(201, {
      number: 43,
      html_url: `https://github.com/${owner}/${repo}/pull/43`,
    });

    // No reviewer endpoint should be called
    const result = await createFixPR(createOctokit(), owner, repo, 'main', mockFix, []);

    expect(result.prNumber).toBe(43);
    expect(api.isDone()).toBe(true); // All interceptors used, no reviewer call
  });
});
