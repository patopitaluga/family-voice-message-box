/**
 * Factory for the platform audio control (record + play).
 * Used from `index.ts`.
 */
import type { AudioControl } from './type-audio-control.ts';
import { createMacAudioControl } from './mac-audio.ts';
import { createRaspberryAudioControl } from './raspberry-audio.ts';

/** Used in `index.ts`. Passed as argv by npm scripts. */
export type Platform = 'raspberry' | 'mac';

/**
 * Used in `index.ts`.
 */
export function createAudioControl(platform: Platform): AudioControl {
  if (platform === 'mac') return createMacAudioControl();

  return createRaspberryAudioControl();
}

/**
 * Used in `index.ts` to read the platform argv from
 * `npm start` / `npm run start:dev`.
 */
export function parsePlatform(
  value: string | undefined = process.argv[2],
): Platform {
  if (value === 'raspberry' || value === 'mac') return value;

  throw new Error(
    'Pass "raspberry" (`npm start`) or "mac" (`npm run start:dev`) as the first argument',
  );
}
