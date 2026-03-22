import type { Octokit } from '@octokit/rest';
import AdmZip from 'adm-zip';
import type { FailedJob } from '../types.js';

/**
 * Fetch workflow run logs as a zip, extract and map to failed jobs.
 */
export async function fetchFailedJobLogs(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number,
): Promise<FailedJob[]> {
  // 1. List jobs to find which ones failed
  const { data: jobsData } = await octokit.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: runId,
    filter: 'latest',
  });

  const failedJobs = jobsData.jobs.filter((j) => j.conclusion === 'failure');

  if (failedJobs.length === 0) {
    return [];
  }

  // 2. Download logs zip
  const { data: logsData } = await octokit.actions.downloadWorkflowRunLogs({
    owner,
    repo,
    run_id: runId,
  });

  const zip = new AdmZip(Buffer.from(logsData as ArrayBuffer));
  const entries = zip.getEntries();

  // 3. Map failed jobs to their logs
  const result: FailedJob[] = [];

  for (const job of failedJobs) {
    const failedStep = job.steps?.find((s) => s.conclusion === 'failure');

    // Log entries are named like "jobName/stepNumber_stepName.txt"
    const jobLogs: string[] = [];
    for (const entry of entries) {
      if (entry.entryName.startsWith(job.name + '/')) {
        jobLogs.push(entry.getData().toString('utf-8'));
      }
    }

    result.push({
      jobId: job.id,
      jobName: job.name,
      stepName: failedStep?.name ?? 'unknown',
      logs: jobLogs.join('\n'),
    });
  }

  return result;
}
