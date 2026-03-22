import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendTeamsNotification } from '../../src/notifications/teams.js';

describe('sendTeamsNotification', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends POST request with JSON body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    globalThis.fetch = mockFetch;

    const card = {
      type: 'message',
      attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {} }],
    };

    await sendTeamsNotification('https://hooks.example.com/webhook', card);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://hooks.example.com/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });
  });

  it('throws on non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request: invalid payload',
    });

    const card = { type: 'message', attachments: [] };

    await expect(
      sendTeamsNotification('https://hooks.example.com/webhook', card),
    ).rejects.toThrow('Teams webhook failed (400): Bad Request: invalid payload');
  });

  it('throws on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const card = { type: 'message', attachments: [] };

    await expect(
      sendTeamsNotification('https://hooks.example.com/webhook', card),
    ).rejects.toThrow('Network error');
  });
});
