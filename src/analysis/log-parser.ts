import stripAnsi from 'strip-ansi';

const MAX_OUTPUT_CHARS = 15_000;
const TAIL_LINES_PER_STEP = 50;

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/;
const GH_MARKER_RE = /^##\[(group|endgroup|command|debug|warning|error|notice)\]/;
const ERROR_RE = /([Ee]rror|ERROR|[Ff]ail|FAIL|[Ff]atal|FATAL|[Ee]xception|EXCEPTION|panic)/;
const STACK_RE = /^\s+at\s+/;

export interface ParsedLog {
  /** Cleaned full log (truncated to MAX_OUTPUT_CHARS) */
  cleaned: string;
  /** Lines containing errors, stack traces, or other signals */
  errorLines: string[];
  /** Last N lines per failed step */
  tailLines: string[];
}

/** Strip ANSI codes, timestamps, and GH Actions markers from a raw log string. */
export function cleanLog(raw: string): string {
  const stripped = stripAnsi(raw);
  return stripped
    .split('\n')
    .map((line) => {
      let l = line.replace(TIMESTAMP_RE, '');
      l = l.replace(GH_MARKER_RE, '');
      return l;
    })
    .join('\n');
}

/** Extract lines matching error patterns + stack traces. */
export function extractErrorLines(cleaned: string): string[] {
  const lines = cleaned.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ERROR_RE.test(line) || STACK_RE.test(line)) {
      result.push(line);
    }
  }

  return result;
}

/** Get the last N lines of a log (useful for each failed step). */
export function extractTailLines(cleaned: string, n: number = TAIL_LINES_PER_STEP): string[] {
  const lines = cleaned.split('\n');
  return lines.slice(-n);
}

/**
 * Truncate text to maxChars while keeping beginning (context) and end (errors).
 * Inserts a "[... truncated ...]" marker in the middle.
 */
export function truncate(text: string, maxChars: number = MAX_OUTPUT_CHARS): string {
  if (text.length <= maxChars) return text;

  const keepStart = Math.floor(maxChars * 0.3);
  const keepEnd = Math.floor(maxChars * 0.6);
  const marker = '\n\n[... truncated middle section ...]\n\n';

  return text.slice(0, keepStart) + marker + text.slice(text.length - keepEnd);
}

/** Full parse pipeline: clean → extract errors → truncate. */
export function parseLogs(rawLogs: string): ParsedLog {
  const cleaned = cleanLog(rawLogs);
  const errorLines = extractErrorLines(cleaned);
  const tailLines = extractTailLines(cleaned);
  const truncated = truncate(cleaned);

  return {
    cleaned: truncated,
    errorLines,
    tailLines,
  };
}
