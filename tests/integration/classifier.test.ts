import { describe, it, expect, vi } from 'vitest';
import { classifyFailure } from '../../src/analysis/classifier.js';
import type { LLMProvider } from '../../src/types.js';

function createMockLLM(response: Record<string, unknown>): LLMProvider {
  return {
    analyze: vi.fn(async () => JSON.stringify(response)),
    analyzeStructured: vi.fn(async (_sys, _user, parse) => {
      return parse(JSON.stringify(response));
    }),
  };
}

describe('classifyFailure', () => {
  it('classifies a code failure', async () => {
    const llm = createMockLLM({
      classification: 'code',
      confidence: 0.9,
      errorSummary: 'TypeError in formatDate',
      rootCause: 'Missing null check',
      suggestedAction: 'Add null guard',
      relatedFiles: ['src/utils.ts'],
    });

    const result = await classifyFailure(llm, 'error logs', ['error line'], []);
    expect(result.classification).toBe('code');
    expect(result.confidence).toBe(0.9);
  });

  it('downgrades low-confidence code classification to non-code', async () => {
    const llm = createMockLLM({
      classification: 'code',
      confidence: 0.4,
      errorSummary: 'Unclear error',
      rootCause: 'Unknown',
      suggestedAction: 'Investigate',
      relatedFiles: [],
    });

    const result = await classifyFailure(llm, 'logs', ['line'], []);
    expect(result.classification).toBe('non-code');
  });

  it('passes past incidents to the LLM prompt', async () => {
    const analyzeSpy = vi.fn(async () =>
      JSON.stringify({
        classification: 'non-code',
        confidence: 0.8,
        errorSummary: 'OOM',
        rootCause: 'Memory',
        suggestedAction: 'Increase',
        relatedFiles: [],
      }),
    );

    const llm: LLMProvider = {
      analyze: analyzeSpy,
      analyzeStructured: vi.fn(async (_sys, user, parse) => {
        return parse(await analyzeSpy(_sys, user));
      }),
    };

    await classifyFailure(llm, 'logs', ['error'], [
      {
        date: '2026-03-21T10:00:00Z',
        repository: 'acme/webapp',
        workflow: 'Build',
        runId: 100,
        runUrl: 'https://example.com',
        classification: 'non-code',
        status: 'manual-action-required',
        errorSummary: 'Previous OOM',
        rootCause: 'Memory',
        resolution: 'Increased runner size',
        relatedPastIncidents: [],
      },
    ]);

    // The user prompt passed to analyzeStructured should include past incidents
    const userPrompt = (llm.analyzeStructured as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(userPrompt).toContain('Past Incidents');
    expect(userPrompt).toContain('Previous OOM');
  });
});
