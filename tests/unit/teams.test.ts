import { describe, it, expect } from 'vitest';
import { buildCodeFixCard, buildNonCodeCard } from '../../src/notifications/teams.js';
import type { WorkflowFailureEvent, AnalysisResult } from '../../src/types.js';

const mockEvent: WorkflowFailureEvent = {
  owner: 'acme',
  repo: 'webapp',
  runId: 12345,
  runUrl: 'https://github.com/acme/webapp/actions/runs/12345',
  workflowName: 'Build and Test',
  branch: 'main',
  commitSha: 'abc123',
  triggeredBy: 'developer',
  failedAt: '2026-03-22T14:00:00Z',
};

const mockAnalysis: AnalysisResult = {
  classification: 'code',
  confidence: 0.9,
  errorSummary: 'TypeError in formatDate',
  rootCause: 'Null input not handled',
  suggestedAction: 'Add null check in formatDate',
  relatedFiles: ['src/utils.ts'],
};

describe('Teams notifications', () => {
  describe('buildCodeFixCard', () => {
    it('builds a valid Adaptive Card', () => {
      const card = buildCodeFixCard(mockEvent, mockAnalysis, {
        prNumber: 42,
        prUrl: 'https://github.com/acme/webapp/pull/42',
      });

      expect(card.type).toBe('message');
      expect(card.attachments).toHaveLength(1);
      const content = card.attachments[0].content;
      expect(content.type).toBe('AdaptiveCard');
      expect((content.body as Array<Record<string, unknown>>)[0]).toMatchObject({
        type: 'TextBlock',
        weight: 'Bolder',
      });
      expect(content.actions).toHaveLength(2);
    });
  });

  describe('buildNonCodeCard', () => {
    it('builds a valid Adaptive Card for non-code issues', () => {
      const nonCodeAnalysis = { ...mockAnalysis, classification: 'non-code' as const };
      const card = buildNonCodeCard(mockEvent, nonCodeAnalysis);

      expect(card.type).toBe('message');
      expect(card.attachments).toHaveLength(1);
      const content = card.attachments[0].content;
      expect(content.actions).toHaveLength(1); // Only "View Workflow Run"
    });
  });
});
