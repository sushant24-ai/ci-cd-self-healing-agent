import { z } from 'zod';

export const repoSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  reviewers: z.array(z.string()).optional().default([]),
  defaultBranch: z.string().optional().default('main'),
});

export const llmSchema = z.object({
  provider: z.enum(['claude', 'openai', 'azure-openai']),
  model: z.string().min(1),
  apiKey: z.string().min(1),
  endpoint: z.string().url().optional(),
  apiVersion: z.string().optional(),
  maxTokens: z.number().int().positive().optional().default(4096),
});

export const teamsSchema = z.object({
  webhookUrl: z.string().url(),
  enabled: z.boolean().optional().default(true),
});

export const safetySchema = z.object({
  maxFilesChanged: z.number().int().positive().optional().default(5),
  maxLineDelta: z.number().int().positive().optional().default(200),
  blockedPaths: z
    .array(z.string())
    .optional()
    .default(['.env*', 'secrets*', '*.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']),
  requireReviewers: z.boolean().optional().default(true),
});

export const agentConfigSchema = z.object({
  repos: z.array(repoSchema).min(1),
  llm: llmSchema,
  teams: teamsSchema,
  safety: safetySchema.optional().default({}),
});

export type ValidatedAgentConfig = z.infer<typeof agentConfigSchema>;
