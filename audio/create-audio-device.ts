import type { AudioDevice } from './audio-device.ts';
import { createMacAudioDevice } from './mac-audio.ts';
import { createRaspberryAudioDevice } from './raspberry-audio.ts';

/** Used in `index.ts` and `listen-for-hold.ts`. Passed as argv by npm scripts. */
export type BoxMode = 'raspberry' | 'mac';

/**
 * Used in `index.ts`.
 */
export function createAudioDevice(mode: BoxMode): AudioDevice {
  if (mode === 'mac') {
    return createMacAudioDevice();
  }

  return createRaspberryAudioDevice();
}

/**
 * Used in `index.ts` to read the mode argv from `npm start` / `npm run start:dev`.
 */
export function resolveBoxMode(
  value: string | undefined = process.argv[2],
): BoxMode {
  if (value === 'raspberry' || value === 'mac') {
    return value;
  }

  throw new Error(
    'Pass "raspberry" (`npm start`) or "mac" (`npm run start:dev`) as the first argument',
  );
}
