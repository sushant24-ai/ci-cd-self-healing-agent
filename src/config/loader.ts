import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { agentConfigSchema, type ValidatedAgentConfig } from './schema.js';

/**
 * Load and validate config from a YAML file.
 * Environment variables in the form ${VAR_NAME} are interpolated.
 */
export function loadConfig(configPath: string): ValidatedAgentConfig {
  const raw = readFileSync(configPath, 'utf-8');
  const interpolated = interpolateEnv(raw);
  const parsed = parseYaml(interpolated);
  return agentConfigSchema.parse(parsed);
}

function interpolateEnv(content: string): string {
  return content.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(`Environment variable ${name} is not set (referenced in config)`);
    }
    return value;
  });
}
