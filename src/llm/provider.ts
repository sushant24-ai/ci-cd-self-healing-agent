import type { LLMProvider, LLMConfig } from '../types.js';

export { type LLMProvider };

/**
 * Factory: create the right LLM provider based on config.
 */
export async function createLLMProvider(config: LLMConfig): Promise<LLMProvider> {
  switch (config.provider) {
    case 'claude': {
      const { ClaudeProvider } = await import('./claude.js');
      return new ClaudeProvider(config);
    }
    case 'openai': {
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(config);
    }
    case 'azure-openai': {
      const { AzureOpenAIProvider } = await import('./azure-openai.js');
      return new AzureOpenAIProvider(config);
    }
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

/**
 * Helper: retry structured parsing up to `retries` times.
 * On validation failure, appends the error message to the prompt and retries.
 */
export async function retryStructured<T>(
  provider: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  parse: (raw: string) => T,
  retries: number = 2,
): Promise<T> {
  let lastError: Error | null = null;
  let prompt = userPrompt;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await provider.analyze(systemPrompt, prompt);
    try {
      return parse(raw);
    } catch (err) {
      lastError = err as Error;
      prompt =
        userPrompt +
        `\n\n[SYSTEM: Your previous response failed validation: ${lastError.message}. Please fix the output format and try again.]`;
    }
  }

  throw new Error(`Structured output failed after ${retries + 1} attempts: ${lastError?.message}`);
}
