import { describe, it, expect, vi } from 'vitest';
import { generateFix } from '../../src/analysis/fixer.js';
import type { LLMProvider, AnalysisResult, SafetyConfig } from '../../src/types.js';

const mockAnalysis: AnalysisResult = {
  classification: 'code',
  confidence: 0.9,
  errorSummary: 'TypeError in formatDate',
  rootCause: 'Missing null check',
  suggestedAction: 'Add null guard',
  relatedFiles: ['src/utils.ts'],
};

const defaultSafety: SafetyConfig = {
  maxFilesChanged: 5,
  maxLineDelta: 200,
  blockedPaths: ['.env*', 'secrets*'],
  requireReviewers: true,
};

function createMockLLM(response: Record<string, unknown>): LLMProvider {
  return {
    analyze: vi.fn(async () => JSON.stringify(response)),
    analyzeStructured: vi.fn(async (_sys, _user, parse) => {
      return parse(JSON.stringify(response));
    }),
  };
}

describe('generateFix', () => {
  it('generates a successful fix', async () => {
    const llm = createMockLLM({
      fixes: [{ path: 'src/utils.ts', fixedContent: 'fixed code' }],
      explanation: 'Added null check',
      prTitle: 'fix: handle null in formatDate',
      prBody: 'Fixes the TypeError',
    });

    const fileContents = new Map([['src/utils.ts', 'original code']]);
    const repoFiles = new Set(['src/utils.ts']);

    const result = await generateFix(llm, mockAnalysis, fileContents, repoFiles, defaultSafety);
    expect(result.success).toBe(true);
    expect(result.fix?.fixes).toHaveLength(1);
    expect(result.fix?.prTitle).toContain('formatDate');
  });

  it('fails when fix exceeds maxFilesChanged', async () => {
    const llm = createMockLLM({
      fixes: Array.from({ length: 6 }, (_, i) => ({
        path: `src/file${i}.ts`,
        fixedContent: 'code',
      })),
      explanation: 'Big fix',
      prTitle: 'fix: big change',
      prBody: 'Many files',
    });

    const fileContents = new Map(
      Array.from({ length: 6 }, (_, i) => [`src/file${i}.ts`, 'code'] as const),
    );
    const repoFiles = new Set(fileContents.keys());

    const result = await generateFix(llm, mockAnalysis, fileContents, repoFiles, defaultSafety);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('exceeds limit');
  });

  it('fails when fix modifies blocked path', async () => {
    const llm = createMockLLM({
      fixes: [{ path: '.env.local', fixedContent: 'SECRET=123' }],
      explanation: 'Fix env',
      prTitle: 'fix: env',
      prBody: 'body',
    });

    const fileContents = new Map([['.env.local', 'old']]);
    const repoFiles = new Set(['.env.local']);

    const result = await generateFix(llm, mockAnalysis, fileContents, repoFiles, defaultSafety);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('blocked path');
  });

  it('fails when fix references non-existent file', async () => {
    const llm = createMockLLM({
      fixes: [{ path: 'src/ghost.ts', fixedContent: 'code' }],
      explanation: 'Fix',
      prTitle: 'fix: ghost',
      prBody: 'body',
    });

    const fileContents = new Map<string, string>();
    const repoFiles = new Set<string>();

    const result = await generateFix(llm, mockAnalysis, fileContents, repoFiles, defaultSafety);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('non-existent');
  });

  it('returns empty fix gracefully', async () => {
    const llm = createMockLLM({
      fixes: [],
      explanation: 'Cannot fix',
      prTitle: '',
      prBody: '',
    });

    const result = await generateFix(
      llm,
      mockAnalysis,
      new Map(),
      new Set(),
      defaultSafety,
    );
    expect(result.success).toBe(false);
    expect(result.reason).toContain('confident fix');
  });
});
