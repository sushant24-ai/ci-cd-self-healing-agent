import OpenAI from 'openai';
import type { LLMProvider, LLMConfig } from '../types.js';
import { retryStructured } from './provider.js';

export class AzureOpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    if (!config.endpoint) {
      throw new Error('Azure OpenAI requires an endpoint in config');
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: `${config.endpoint}/openai/deployments/${config.model}`,
      defaultQuery: { 'api-version': config.apiVersion ?? '2024-08-01-preview' },
      defaultHeaders: { 'api-key': config.apiKey },
    });
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 4096;
  }

  async analyze(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Azure OpenAI returned no content');
    }
    return content;
  }

  async analyzeStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    parse: (raw: string) => T,
    retries: number = 2,
  ): Promise<T> {
    return retryStructured(this, systemPrompt, userPrompt, parse, retries);
  }
}
