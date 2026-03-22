import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { agentConfigSchema } from '../../src/config/schema.js';
import { loadConfig } from '../../src/config/loader.js';

const FIXTURE_PATH = join(import.meta.dirname, '..', 'fixtures', 'sample-config.yml');

describe('config schema', () => {
  it('validates a complete config', () => {
    const result = agentConfigSchema.safeParse({
      repos: [{ owner: 'acme', repo: 'webapp' }],
      llm: { provider: 'claude', model: 'claude-sonnet-4-20250514', apiKey: 'sk-test' },
      teams: { webhookUrl: 'https://example.com/webhook' },
    });
    expect(result.success).toBe(true);
  });

  it('applies defaults', () => {
    const result = agentConfigSchema.parse({
      repos: [{ owner: 'acme', repo: 'webapp' }],
      llm: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' },
      teams: { webhookUrl: 'https://example.com/webhook' },
    });
    expect(result.safety.maxFilesChanged).toBe(5);
    expect(result.safety.maxLineDelta).toBe(200);
    expect(result.safety.requireReviewers).toBe(true);
    expect(result.repos[0].defaultBranch).toBe('main');
  });

  it('rejects missing required fields', () => {
    const result = agentConfigSchema.safeParse({
      repos: [],
      llm: { provider: 'claude' },
      teams: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid LLM provider', () => {
    const result = agentConfigSchema.safeParse({
      repos: [{ owner: 'x', repo: 'y' }],
      llm: { provider: 'gemini', model: 'test', apiKey: 'k' },
      teams: { webhookUrl: 'https://example.com' },
    });
    expect(result.success).toBe(false);
  });
});

describe('config loader', () => {
  it('loads and validates YAML config from fixture', () => {
    const config = loadConfig(FIXTURE_PATH);
    expect(config.repos).toHaveLength(1);
    expect(config.repos[0].owner).toBe('acme');
    expect(config.llm.provider).toBe('claude');
    expect(config.teams.enabled).toBe(true);
  });
});
