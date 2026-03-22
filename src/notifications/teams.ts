import type { AnalysisResult, WorkflowFailureEvent } from '../types.js';

interface AdaptiveCard {
  type: string;
  attachments: Array<{
    contentType: string;
    content: Record<string, unknown>;
  }>;
}

/**
 * Send an Adaptive Card to a Teams incoming webhook.
 */
export async function sendTeamsNotification(
  webhookUrl: string,
  card: AdaptiveCard,
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Teams webhook failed (${response.status}): ${body}`);
  }
}

/**
 * Build an Adaptive Card for a code fix PR.
 */
export function buildCodeFixCard(
  event: WorkflowFailureEvent,
  analysis: AnalysisResult,
  pr: { prNumber: number; prUrl: string },
): AdaptiveCard {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              size: 'Medium',
              weight: 'Bolder',
              text: `🔧 Auto-Fix PR Created`,
              wrap: true,
            },
            {
              type: 'FactSet',
              facts: [
                { title: 'Repository', value: `${event.owner}/${event.repo}` },
                { title: 'Workflow', value: event.workflowName },
                { title: 'Branch', value: event.branch },
                { title: 'Triggered by', value: event.triggeredBy },
                { title: 'Classification', value: analysis.classification },
                { title: 'Confidence', value: `${(analysis.confidence * 100).toFixed(0)}%` },
              ],
            },
            {
              type: 'TextBlock',
              text: `**Error:** ${analysis.errorSummary}`,
              wrap: true,
            },
            {
              type: 'TextBlock',
              text: `**Root Cause:** ${analysis.rootCause}`,
              wrap: true,
            },
          ],
          actions: [
            {
              type: 'Action.OpenUrl',
              title: `Review PR #${pr.prNumber}`,
              url: pr.prUrl,
            },
            {
              type: 'Action.OpenUrl',
              title: 'View Workflow Run',
              url: event.runUrl,
            },
          ],
        },
      },
    ],
  };
}

/**
 * Build an Adaptive Card for a non-code issue notification.
 */
export function buildNonCodeCard(
  event: WorkflowFailureEvent,
  analysis: AnalysisResult,
): AdaptiveCard {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              size: 'Medium',
              weight: 'Bolder',
              text: `⚠️ CI Failure — Manual Action Required`,
              wrap: true,
            },
            {
              type: 'FactSet',
              facts: [
                { title: 'Repository', value: `${event.owner}/${event.repo}` },
                { title: 'Workflow', value: event.workflowName },
                { title: 'Branch', value: event.branch },
                { title: 'Triggered by', value: event.triggeredBy },
                { title: 'Classification', value: 'Non-code issue' },
                { title: 'Confidence', value: `${(analysis.confidence * 100).toFixed(0)}%` },
              ],
            },
            {
              type: 'TextBlock',
              text: `**Error:** ${analysis.errorSummary}`,
              wrap: true,
            },
            {
              type: 'TextBlock',
              text: `**Root Cause:** ${analysis.rootCause}`,
              wrap: true,
            },
            {
              type: 'TextBlock',
              text: `**Recommended Action:** ${analysis.suggestedAction}`,
              wrap: true,
            },
          ],
          actions: [
            {
              type: 'Action.OpenUrl',
              title: 'View Workflow Run',
              url: event.runUrl,
            },
          ],
        },
      },
    ],
  };
}
