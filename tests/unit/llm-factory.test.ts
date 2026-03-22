import { describe, it, expect } from 'vitest';
import { createLLMProvider } from '../../src/llm/provider.js';
import type { LLMConfig } from '../../src/types.js';

describe('createLLMProvider factory', () => {
  it('creates Claude provider', async () => {
    const config: LLMConfig = {
      provider: 'claude',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'test-key',
    };

    const provider = await createLLMProvider(config);
    expect(provider).toBeDefined();
    expect(typeof provider.analyze).toBe('function');
    expect(typeof provider.analyzeStructured).toBe('function');
  });

  it('creates OpenAI provider', async () => {
    const config: LLMConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
    };

    const provider = await createLLMProvider(config);
    expect(provider).toBeDefined();
    expect(typeof provider.analyze).toBe('function');
  });

  it('creates Azure OpenAI provider', async () => {
    const config: LLMConfig = {
      provider: 'azure-openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
      endpoint: 'https://my-resource.openai.azure.com',
      apiVersion: '2024-08-01-preview',
    };

    const provider = await createLLMProvider(config);
    expect(provider).toBeDefined();
    expect(typeof provider.analyze).toBe('function');
  });

  it('throws for Azure without endpoint', async () => {
    const config: LLMConfig = {
      provider: 'azure-openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
      // no endpoint
    };

    await expect(createLLMProvider(config)).rejects.toThrow('requires an endpoint');
  });

  it('throws for unknown provider', async () => {
    const config = {
      provider: 'gemini' as any,
      model: 'gemini-pro',
      apiKey: 'test-key',
    };

    await expect(createLLMProvider(config)).rejects.toThrow('Unknown LLM provider');
  });
});
