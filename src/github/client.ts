import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

export interface GitHubClientConfig {
  /** Use App auth if appId + privateKey are provided */
  appId?: number;
  privateKey?: string;
  installationId?: number;
  /** Use PAT auth if token is provided */
  token?: string;
}

/**
 * Create an authenticated Octokit instance.
 * Supports GitHub App (installation token) or PAT auth.
 */
export function createGitHubClient(config: GitHubClientConfig): Octokit {
  if (config.appId && config.privateKey && config.installationId) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: config.appId,
        privateKey: config.privateKey,
        installationId: config.installationId,
      },
      throttle: {
        onRateLimit: (retryAfter: number, options: Record<string, unknown>) => {
          console.warn(`Rate limit hit for ${JSON.stringify(options)}, retrying after ${retryAfter}s`);
          return true; // retry
        },
        onSecondaryRateLimit: (retryAfter: number, options: Record<string, unknown>) => {
          console.warn(`Secondary rate limit for ${JSON.stringify(options)}, retrying after ${retryAfter}s`);
          return true;
        },
      },
    });
  }

  if (config.token) {
    return new Octokit({ auth: config.token });
  }

  throw new Error('GitHub client requires either App credentials (appId + privateKey + installationId) or a token');
}
