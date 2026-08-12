import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const RECORDINGS_DIR = 'recordings';

/**
 * Used in `index.ts` and `play-last.ts`.
 * Returns the newest `.wav` path under `recordings/`, or `undefined` if none.
 */
export async function findLatestRecordingPath(): Promise<string | undefined> {
  let names: string[];
  try {
    names = (await readdir(RECORDINGS_DIR)).filter((name) =>
      name.endsWith('.wav'),
    );
  } catch {
    return undefined;
  }

  if (names.length === 0) {
    return undefined;
  }

  names.sort();
  const latestName = names.at(-1);
  if (!latestName) {
    return undefined;
  }

  return join(RECORDINGS_DIR, latestName);
}
