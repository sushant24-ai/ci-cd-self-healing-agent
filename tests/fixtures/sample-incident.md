# CI Incident: Build and Test

| Field | Value |
|-------|-------|
| Date | 2026-03-21T10:00:00Z |
| Repository | acme/webapp |
| Workflow | Build and Test |
| Run | [#100](https://github.com/acme/webapp/actions/runs/100) |
| Classification | code |
| Status | auto-fixed |

## Error Summary
TypeError in formatDate: undefined does not have toISOString

## Root Cause Analysis
The `formatDate` function in `src/utils.ts` does not handle null/undefined input.

## Resolution
Added a null check before calling toISOString().

## Related Past Incidents
None
