import { describe, it, expect } from 'vitest';
import { createGitHubClient } from '../../src/github/client.js';

describe('createGitHubClient', () => {
  it('creates client with PAT token', () => {
    const client = createGitHubClient({ token: 'ghp_testtoken123' });
    expect(client).toBeDefined();
    expect(typeof client.repos.get).toBe('function');
  });

  it('throws when no credentials provided', () => {
    expect(() => createGitHubClient({})).toThrow(
      'GitHub client requires either App credentials',
    );
  });

  it('throws when App credentials are partial (missing installationId)', () => {
    expect(() =>
      createGitHubClient({
        appId: 12345,
        privateKey: 'fake-key',
        // installationId missing
      }),
    ).toThrow('GitHub client requires either App credentials');
  });
});
