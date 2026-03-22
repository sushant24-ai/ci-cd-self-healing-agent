import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/loader.js';

describe('config loader — env interpolation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'heal-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.TEST_API_KEY;
    delete process.env.TEST_WEBHOOK;
  });

  it('interpolates ${VAR_NAME} from environment', () => {
    process.env.TEST_API_KEY = 'sk-secret-123';
    process.env.TEST_WEBHOOK = 'https://hooks.example.com/webhook';

    const configPath = join(tmpDir, 'config.yml');
    writeFileSync(
      configPath,
      `
repos:
  - owner: test
    repo: app
llm:
  provider: claude
  model: claude-sonnet-4-20250514
  apiKey: \${TEST_API_KEY}
teams:
  webhookUrl: \${TEST_WEBHOOK}
`,
    );

    const config = loadConfig(configPath);
    expect(config.llm.apiKey).toBe('sk-secret-123');
    expect(config.teams.webhookUrl).toBe('https://hooks.example.com/webhook');
  });

  it('throws when referenced env var is not set', () => {
    const configPath = join(tmpDir, 'config.yml');
    writeFileSync(
      configPath,
      `
repos:
  - owner: test
    repo: app
llm:
  provider: claude
  model: test
  apiKey: \${MISSING_VAR_XYZ}
teams:
  webhookUrl: https://example.com
`,
    );

    expect(() => loadConfig(configPath)).toThrow('MISSING_VAR_XYZ is not set');
  });

  it('throws on invalid YAML structure', () => {
    const configPath = join(tmpDir, 'config.yml');
    writeFileSync(configPath, 'repos: "not an array"');

    expect(() => loadConfig(configPath)).toThrow();
  });
});
