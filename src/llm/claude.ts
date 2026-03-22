import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMConfig } from '../types.js';
import { retryStructured } from './provider.js';

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 4096;
  }

  async analyze(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Claude returned no text content');
    }
    return textBlock.text;
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
