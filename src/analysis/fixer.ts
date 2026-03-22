import { z } from 'zod';
import type { LLMProvider, AnalysisResult, CodeFix, SafetyConfig } from '../types.js';

const fixSchema = z.object({
  fixes: z.array(
    z.object({
      path: z.string(),
      fixedContent: z.string(),
    }),
  ),
  explanation: z.string(),
  prTitle: z.string(),
  prBody: z.string(),
});

const SYSTEM_PROMPT = `You are a code repair agent. Given a CI failure analysis and the contents of the files that need fixing, generate minimal, targeted fixes.

Rules:
- Only change what is necessary to fix the failure
- Do not refactor, improve style, or add features
- Do not modify files you were not asked about
- Preserve the original formatting and style of the code
- If you cannot confidently fix the issue, return an empty fixes array

Respond with ONLY a JSON object:
{
  "fixes": [
    {
      "path": "relative/file/path",
      "fixedContent": "complete file content with fix applied"
    }
  ],
  "explanation": "What was changed and why",
  "prTitle": "fix: brief description (under 72 chars)",
  "prBody": "Markdown PR body explaining the fix"
}`;

function buildUserPrompt(
  analysis: AnalysisResult,
  fileContents: Map<string, string>,
): string {
  let prompt = `## Failure Analysis\n`;
  prompt += `- Error: ${analysis.errorSummary}\n`;
  prompt += `- Root Cause: ${analysis.rootCause}\n`;
  prompt += `- Suggested Action: ${analysis.suggestedAction}\n\n`;
  prompt += `## Files to Fix\n`;

  for (const [path, content] of fileContents) {
    prompt += `\n### ${path}\n\`\`\`\n${content}\n\`\`\`\n`;
  }

  return prompt;
}

function parseFix(raw: string): z.infer<typeof fixSchema> {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
  const jsonStr = jsonMatch[1]!.trim();
  const parsed = JSON.parse(jsonStr);
  return fixSchema.parse(parsed);
}

export interface FixResult {
  success: boolean;
  fix?: CodeFix;
  reason?: string;
}

/**
 * Generate a code fix using LLM, then validate against safety limits.
 */
export async function generateFix(
  llm: LLMProvider,
  analysis: AnalysisResult,
  fileContents: Map<string, string>,
  repoFiles: Set<string>,
  safety: SafetyConfig,
): Promise<FixResult> {
  const userPrompt = buildUserPrompt(analysis, fileContents);
  let result: z.infer<typeof fixSchema>;

  try {
    result = await llm.analyzeStructured(SYSTEM_PROMPT, userPrompt, parseFix, 2);
  } catch {
    return { success: false, reason: 'LLM failed to generate a valid fix' };
  }

  if (result.fixes.length === 0) {
    return { success: false, reason: 'LLM could not generate a confident fix' };
  }

  // Safety check: file count
  if (result.fixes.length > safety.maxFilesChanged) {
    return {
      success: false,
      reason: `Fix touches ${result.fixes.length} files, exceeds limit of ${safety.maxFilesChanged}`,
    };
  }

  // Safety check: blocked paths
  for (const fix of result.fixes) {
    if (isBlockedPath(fix.path, safety.blockedPaths)) {
      return { success: false, reason: `Fix modifies blocked path: ${fix.path}` };
    }
  }

  // Safety check: verify paths exist in repo
  for (const fix of result.fixes) {
    if (!repoFiles.has(fix.path)) {
      return { success: false, reason: `Fix references non-existent file: ${fix.path}` };
    }
  }

  // Safety check: line delta
  let totalDelta = 0;
  for (const fix of result.fixes) {
    const original = fileContents.get(fix.path) ?? '';
    const originalLines = original.split('\n').length;
    const fixedLines = fix.fixedContent.split('\n').length;
    totalDelta += Math.abs(fixedLines - originalLines);
  }

  if (totalDelta > safety.maxLineDelta) {
    return {
      success: false,
      reason: `Fix has ${totalDelta} line delta, exceeds limit of ${safety.maxLineDelta}`,
    };
  }

  return {
    success: true,
    fix: {
      fixes: result.fixes.map((f) => ({
        path: f.path,
        originalContent: fileContents.get(f.path) ?? '',
        fixedContent: f.fixedContent,
      })),
      explanation: result.explanation,
      prTitle: result.prTitle,
      prBody: result.prBody,
    },
  };
}

function isBlockedPath(filePath: string, blockedPatterns: string[]): boolean {
  for (const pattern of blockedPatterns) {
    // Simple glob matching: convert pattern to regex
    const re = new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$',
    );
    if (re.test(filePath)) return true;
  }
  return false;
}
