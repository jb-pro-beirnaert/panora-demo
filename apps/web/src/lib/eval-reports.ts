import 'server-only';
import { EvalReportSchema, type EvalReport } from '@demo/shared';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Reports written by `npm run evals` (evals/reports/*.json), newest first. */
const REPORTS_DIR =
  process.env.EVALS_REPORTS_DIR ?? path.resolve(process.cwd(), '../../evals/reports');

export async function loadEvalReports(): Promise<EvalReport[]> {
  let files: string[];
  try {
    files = await readdir(REPORTS_DIR);
  } catch {
    return [];
  }
  const reports: EvalReport[] = [];
  for (const file of files) {
    if (!file.endsWith('.json') || file === 'latest.json' || file === 'baseline.json') continue;
    try {
      const parsed = EvalReportSchema.safeParse(
        JSON.parse(await readFile(path.join(REPORTS_DIR, file), 'utf8')),
      );
      if (parsed.success) reports.push(parsed.data);
    } catch {
      // unreadable report: skipped
    }
  }
  return reports.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
