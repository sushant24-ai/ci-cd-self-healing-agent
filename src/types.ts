// ── Event types ──────────────────────────────────────────────

export interface WorkflowFailureEvent {
  owner: string;
  repo: string;
  runId: number;
  runUrl: string;
  workflowName: string;
  branch: string;
  commitSha: string;
  triggeredBy: string;
  failedAt: string;
}

export interface FailedJob {
  jobId: number;
  jobName: string;
  stepName: string;
  logs: string;
}

// ── Analysis types ───────────────────────────────────────────

export type Classification = 'code' | 'non-code';

export interface AnalysisResult {
  classification: Classification;
  confidence: number;
  errorSummary: string;
  rootCause: string;
  suggestedAction: string;
  relatedFiles: string[];
}

export interface FileFix {
  path: string;
  originalContent: string;
  fixedContent: string;
}

export interface CodeFix {
  fixes: FileFix[];
  explanation: string;
  prTitle: string;
  prBody: string;
}

// ── Incident memory ──────────────────────────────────────────

export type IncidentStatus = 'auto-fixed' | 'manual-action-required';

export interface IncidentRecord {
  date: string;
  repository: string;
  workflow: string;
  runId: number;
  runUrl: string;
  classification: Classification;
  status: IncidentStatus;
  errorSummary: string;
  rootCause: string;
  resolution: string;
  relatedPastIncidents: string[];
}

// ── Config types ─────────────────────────────────────────────

export interface RepoConfig {
  owner: string;
  repo: string;
  reviewers?: string[];
  defaultBranch?: string;
}

export type LLMProviderType = 'claude' | 'openai' | 'azure-openai';

export interface LLMConfig {
  provider: LLMProviderType;
  model: string;
  apiKey: string;
  /** Azure-only */
  endpoint?: string;
  apiVersion?: string;
  maxTokens?: number;
}

export interface TeamsConfig {
  webhookUrl: string;
  enabled: boolean;
}

export interface SafetyConfig {
  maxFilesChanged: number;
  maxLineDelta: number;
  blockedPaths: string[];
  requireReviewers: boolean;
}

export interface AgentConfig {
  repos: RepoConfig[];
  llm: LLMConfig;
  teams: TeamsConfig;
  safety: SafetyConfig;
}

// ── LLM provider interface ───────────────────────────────────

export interface LLMProvider {
  analyze(systemPrompt: string, userPrompt: string): Promise<string>;
  analyzeStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    parse: (raw: string) => T,
    retries?: number,
  ): Promise<T>;
}
