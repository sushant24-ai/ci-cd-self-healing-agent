import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanLog, extractErrorLines, extractTailLines, truncate, parseLogs } from '../../src/analysis/log-parser.js';

const FIXTURE_PATH = join(import.meta.dirname, '..', 'fixtures', 'sample-log.txt');
const sampleLog = readFileSync(FIXTURE_PATH, 'utf-8');

describe('log-parser', () => {
  describe('cleanLog', () => {
    it('strips timestamps', () => {
      const cleaned = cleanLog(sampleLog);
      expect(cleaned).not.toMatch(/2026-03-22T/);
    });

    it('strips GitHub Actions markers', () => {
      const cleaned = cleanLog(sampleLog);
      expect(cleaned).not.toMatch(/##\[group\]/);
      expect(cleaned).not.toMatch(/##\[endgroup\]/);
      expect(cleaned).not.toMatch(/##\[error\]/);
    });

    it('preserves meaningful content', () => {
      const cleaned = cleanLog(sampleLog);
      expect(cleaned).toContain('TypeError: Cannot read properties of undefined');
      expect(cleaned).toContain('at formatDate');
    });

    it('strips ANSI escape codes', () => {
      const withAnsi = '\x1b[31mError: something broke\x1b[0m';
      const cleaned = cleanLog(withAnsi);
      expect(cleaned).toBe('Error: something broke');
    });
  });

  describe('extractErrorLines', () => {
    it('extracts lines with error keywords', () => {
      const cleaned = cleanLog(sampleLog);
      const errors = extractErrorLines(cleaned);
      expect(errors.some((l) => l.includes('TypeError'))).toBe(true);
      expect(errors.some((l) => l.includes('FAIL'))).toBe(true);
    });

    it('extracts stack trace lines', () => {
      const cleaned = cleanLog(sampleLog);
      const errors = extractErrorLines(cleaned);
      expect(errors.some((l) => l.includes('at formatDate'))).toBe(true);
    });
  });

  describe('extractTailLines', () => {
    it('returns last N lines', () => {
      const cleaned = cleanLog(sampleLog);
      const tail = extractTailLines(cleaned, 3);
      expect(tail.length).toBe(3);
    });

    it('returns all lines if fewer than N', () => {
      const tail = extractTailLines('line1\nline2', 50);
      expect(tail.length).toBe(2);
    });
  });

  describe('truncate', () => {
    it('returns short text unchanged', () => {
      expect(truncate('short', 100)).toBe('short');
    });

    it('truncates long text with marker', () => {
      const long = 'x'.repeat(20_000);
      const result = truncate(long, 15_000);
      expect(result.length).toBeLessThanOrEqual(15_100); // allow marker overhead
      expect(result).toContain('[... truncated middle section ...]');
    });

    it('preserves beginning and end', () => {
      const text = 'START' + 'x'.repeat(20_000) + 'END';
      const result = truncate(text, 15_000);
      expect(result.startsWith('START')).toBe(true);
      expect(result.endsWith('END')).toBe(true);
    });
  });

  describe('parseLogs', () => {
    it('returns cleaned, errorLines, and tailLines', () => {
      const result = parseLogs(sampleLog);
      expect(result.cleaned).toBeDefined();
      expect(result.errorLines.length).toBeGreaterThan(0);
      expect(result.tailLines.length).toBeGreaterThan(0);
    });

    it('handles empty input', () => {
      const result = parseLogs('');
      expect(result.cleaned).toBe('');
      expect(result.errorLines).toEqual([]);
      expect(result.tailLines).toEqual(['']);
    });
  });
});
