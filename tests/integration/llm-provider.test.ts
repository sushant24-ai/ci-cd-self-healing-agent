import { describe, it, expect, vi } from 'vitest';
import { retryStructured } from '../../src/llm/provider.js';
import type { LLMProvider } from '../../src/types.js';

function createMockProvider(responses: string[]): LLMProvider {
  let callCount = 0;
  return {
    analyze: vi.fn(async () => {
      const response = responses[callCount] ?? responses[responses.length - 1];
      callCount++;
      return response;
    }),
    analyzeStructured: vi.fn(async (sys, user, parse, retries) => {
      return retryStructured(
        { analyze: async () => responses[0], analyzeStructured: vi.fn() },
        sys,
        user,
        parse,
        retries,
      );
    }),
  };
}

describe('retryStructured', () => {
  it('parses valid response on first try', async () => {
    const provider = createMockProvider(['{"value": 42}']);
    const result = await retryStructured(
      provider,
      'system',
      'user',
      (raw) => JSON.parse(raw) as { value: number },
    );
    expect(result).toEqual({ value: 42 });
    expect(provider.analyze).toHaveBeenCalledTimes(1);
  });

  it('retries on parse failure and succeeds', async () => {
    const provider = createMockProvider(['not json', '{"value": 42}']);
    const result = await retryStructured(
      provider,
      'system',
      'user',
      (raw) => JSON.parse(raw) as { value: number },
      2,
    );
    expect(result).toEqual({ value: 42 });
    expect(provider.analyze).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries', async () => {
    const provider = createMockProvider(['bad', 'bad', 'bad']);
    await expect(
      retryStructured(provider, 'system', 'user', (raw) => JSON.parse(raw) as unknown, 1),
    ).rejects.toThrow('Structured output failed after 2 attempts');
  });
});
