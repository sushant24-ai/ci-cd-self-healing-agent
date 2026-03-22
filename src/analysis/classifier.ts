import { z } from 'zod';
import type { LLMProvider, AnalysisResult, IncidentRecord } from '../types.js';

const CONFIDENCE_THRESHOLD = 0.6;

const classificationSchema = z.object({
  classification: z.enum(['code', 'non-code']),
  confidence: z.number().min(0).max(1),
  errorSummary: z.string(),
  rootCause: z.string(),
  suggestedAction: z.string(),
  relatedFiles: z.array(z.string()),
});

const SYSTEM_PROMPT = `You are a CI/CD failure analyst. Given CI logs and optional past incident history, classify the failure and analyze its root cause.

Classification rules:
- "code": The failure is caused by a bug or error in the application source code that can be fixed by editing files in the repository. Examples: syntax errors, type errors, test failures due to wrong logic, missing imports.
- "non-code": The failure is caused by infrastructure, environment, flaky tests, network issues, dependency resolution, permissions, or configuration outside the repo. Examples: OOM, timeout, npm registry down, Docker pull failures, rate limiting.

Respond with ONLY a JSON object matching this schema:
{
  "classification": "code" | "non-code",
  "confidence": 0.0-1.0,
  "errorSummary": "Brief one-line summary of the error",
  "rootCause": "Detailed root cause analysis",
  "suggestedAction": "What should be done to fix this",
  "relatedFiles": ["file/paths/that/may/need/changes"]
}`;

function buildUserPrompt(
  logs: string,
  errorLines: string[],
  pastIncidents: IncidentRecord[],
): string {
  let prompt = `## CI Log Output (cleaned)\n\`\`\`\n${logs}\n\`\`\`\n`;
  prompt += `\n## Extracted Error Lines\n\`\`\`\n${errorLines.join('\n')}\n\`\`\`\n`;

  if (pastIncidents.length > 0) {
    prompt += '\n## Past Incidents (for context)\n';
    for (const inc of pastIncidents.slice(0, 5)) {
      prompt += `- [${inc.date}] ${inc.workflow}: ${inc.errorSummary} → ${inc.status}\n`;
    }
  }

  return prompt;
}

function parseClassification(raw: string): z.infer<typeof classificationSchema> {
  // Extract JSON from possible markdown code fences
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
  const jsonStr = jsonMatch[1]!.trim();
  const parsed = JSON.parse(jsonStr);
  return classificationSchema.parse(parsed);
}

export async function classifyFailure(
  llm: LLMProvider,
  logs: string,
  errorLines: string[],
  pastIncidents: IncidentRecord[],
): Promise<AnalysisResult> {
  const userPrompt = buildUserPrompt(logs, errorLines, pastIncidents);

  const result = await llm.analyzeStructured(
    SYSTEM_PROMPT,
    userPrompt,
    parseClassification,
    2,
  );

  // Safety: low confidence → default to non-code
  if (result.confidence < CONFIDENCE_THRESHOLD) {
    return {
      ...result,
      classification: 'non-code',
    };
  }

  return result;
}
