#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Setup a test target repository for E2E testing the self-healing agent.
#
# This script creates a repo with:
#   1. A simple Node.js app with a deliberate bug
#   2. A CI workflow that runs tests (and will fail because of the bug)
#
# Usage:
#   ./scripts/setup-test-repo.sh <github-user-or-org>
#
# Prerequisites:
#   - gh CLI authenticated
#   - Node.js installed
# =============================================================================

OWNER="${1:?Usage: setup-test-repo.sh <github-user-or-org>}"
REPO="heal-test-target"
FULL="${OWNER}/${REPO}"

echo "==> Creating test repo: ${FULL}"
gh repo create "${REPO}" --public --clone || true
cd "${REPO}"

# --- Package setup ---
cat > package.json << 'PKG'
{
  "name": "heal-test-target",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test src/*.test.js"
  }
}
PKG

# --- Source file with deliberate bug ---
mkdir -p src
cat > src/utils.js << 'SRC'
// BUG: does not handle null/undefined input
export function formatDate(date) {
  return date.toISOString().split('T')[0];
}

export function add(a, b) {
  return a + b;
}
SRC

# --- Test that will fail ---
cat > src/utils.test.js << 'TEST'
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatDate, add } from './utils.js';

describe('formatDate', () => {
  it('formats a valid date', () => {
    assert.strictEqual(formatDate(new Date('2026-01-15')), '2026-01-15');
  });

  it('handles null input', () => {
    // This will cause a TypeError — the bug the agent should fix
    const result = formatDate(null);
    assert.strictEqual(result, 'Invalid Date');
  });
});

describe('add', () => {
  it('adds two numbers', () => {
    assert.strictEqual(add(1, 2), 3);
  });
});
TEST

# --- CI workflow ---
mkdir -p .github/workflows
cat > .github/workflows/ci.yml << 'CI'
name: Build and Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm test
CI

# --- Push ---
git add -A
git commit -m "feat: initial app with deliberate bug for heal agent testing"
git push -u origin main

echo ""
echo "==> Test repo created: https://github.com/${FULL}"
echo "==> The CI workflow will fail on the formatDate(null) test."
echo ""
echo "Next steps:"
echo "  1. Wait for the CI workflow to fail"
echo "  2. Get the failed run ID:  gh run list -R ${FULL} --status failure"
echo "  3. Trigger the heal agent:  gh workflow run heal.yml -f owner=${OWNER} -f repo=${REPO} -f run_id=<RUN_ID>"
