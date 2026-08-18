/**
 * Shared temp directory for outbound recordings and inbound Telegram voices.
 * Used in `index.ts` and `listen-family-group-voices.ts`.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const TEMP_DIR = 'temp';

/** Used in `index.ts` and `listen-family-group-voices.ts`. */
export async function ensureTempDir(): Promise<string> {
  await mkdir(TEMP_DIR, { recursive: true });
  return TEMP_DIR;
}

/** Used in `index.ts` and `listen-family-group-voices.ts`. */
export function tempPath(fileName: string): string {
  return join(TEMP_DIR, fileName);
}
