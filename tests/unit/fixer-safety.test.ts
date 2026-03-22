import { describe, it, expect, vi } from 'vitest';
import { generateFix } from '../../src/analysis/fixer.js';
import type { LLMProvider, AnalysisResult, SafetyConfig } from '../../src/types.js';

const mockAnalysis: AnalysisResult = {
  classification: 'code',
  confidence: 0.9,
  errorSummary: 'Test error',
  rootCause: 'Test cause',
  suggestedAction: 'Test action',
  relatedFiles: ['src/app.ts'],
};

const safety: SafetyConfig = {
  maxFilesChanged: 5,
  maxLineDelta: 10, // Very strict for testing
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

describe('fixer — maxLineDelta safety', () => {
  it('rejects fix when line delta exceeds limit', async () => {
    const original = 'line1\nline2\n';
    // Add 20 new lines → delta of 20, exceeds limit of 10
    const fixed = 'line1\nline2\n' + Array.from({ length: 20 }, (_, i) => `new-line-${i}`).join('\n');

    const llm = createMockLLM({
      fixes: [{ path: 'src/app.ts', fixedContent: fixed }],
      explanation: 'Big fix',
      prTitle: 'fix: big change',
      prBody: 'body',
    });

    const fileContents = new Map([['src/app.ts', original]]);
    const repoFiles = new Set(['src/app.ts']);

    const result = await generateFix(llm, mockAnalysis, fileContents, repoFiles, safety);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('line delta');
    expect(result.reason).toContain('exceeds limit of 10');
  });

  it('accepts fix when line delta is within limit', async () => {
    const original = 'line1\nline2\n';
    const fixed = 'line1\nline2\nline3\n'; // delta of 1

    const llm = createMockLLM({
      fixes: [{ path: 'src/app.ts', fixedContent: fixed }],
      explanation: 'Small fix',
      prTitle: 'fix: small',
      prBody: 'body',
    });

    const fileContents = new Map([['src/app.ts', original]]);
    const repoFiles = new Set(['src/app.ts']);

    const result = await generateFix(llm, mockAnalysis, fileContents, repoFiles, safety);
    expect(result.success).toBe(true);
  });
});

describe('fixer — blocked path patterns', () => {
  it('blocks secrets directory files', async () => {
    const llm = createMockLLM({
      fixes: [{ path: 'secrets.json', fixedContent: '{}' }],
      explanation: 'Fix',
      prTitle: 'fix: secrets',
      prBody: 'body',
    });

    const result = await generateFix(
      llm,
      mockAnalysis,
      new Map([['secrets.json', '{}']]),
      new Set(['secrets.json']),
      safety,
    );
    expect(result.success).toBe(false);
    expect(result.reason).toContain('blocked path');
  });

  it('blocks .env.production', async () => {
    const llm = createMockLLM({
      fixes: [{ path: '.env.production', fixedContent: 'KEY=val' }],
      explanation: 'Fix',
      prTitle: 'fix: env',
      prBody: 'body',
    });

    const result = await generateFix(
      llm,
      mockAnalysis,
      new Map([['.env.production', 'KEY=old']]),
      new Set(['.env.production']),
      safety,
    );
    expect(result.success).toBe(false);
    expect(result.reason).toContain('blocked path');
  });

  it('allows normal source files', async () => {
    const llm = createMockLLM({
      fixes: [{ path: 'src/app.ts', fixedContent: 'fixed' }],
      explanation: 'Fix',
      prTitle: 'fix: app',
      prBody: 'body',
    });

    const result = await generateFix(
      llm,
      mockAnalysis,
      new Map([['src/app.ts', 'broken']]),
      new Set(['src/app.ts']),
      safety,
    );
    expect(result.success).toBe(true);
  });
});

describe('fixer — LLM failure handling', () => {
  it('returns failure when LLM throws', async () => {
    const llm: LLMProvider = {
      analyze: vi.fn(async () => { throw new Error('API down'); }),
      analyzeStructured: vi.fn(async () => { throw new Error('API down'); }),
    };

    const result = await generateFix(
      llm,
      mockAnalysis,
      new Map([['src/app.ts', 'code']]),
      new Set(['src/app.ts']),
      safety,
    );
    expect(result.success).toBe(false);
    expect(result.reason).toContain('failed to generate');
  });
});
