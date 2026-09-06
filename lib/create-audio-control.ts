/**
 * Factory for the platform audio control (record + play).
 * Used from `index.ts`.
 */
import type { AudioControl } from './type-audio-control.ts';
import { createMacAudioControl } from './mac-audio.ts';
import { createRaspberryAudioControl } from './raspberry-audio.ts';
import { isRaspberryPiOsHost } from './is-raspberry-pi-os-host.ts';

/** Used in `index.ts`. Which audio and GPIO backend this machine can drive. */
export type Platform = 'raspberry' | 'mac';

/**
 * Used in `index.ts`. Orthogonal to `Platform`: the Pi runs both, the Mac only `dev`.
 * `prod` is the box doing its job (buttons only); `dev` adds keyboard control.
 */
export type RunMode = 'prod' | 'dev';

/**
 * Used in `index.ts`.
 */
export function createAudioControl(platform: Platform): AudioControl {
  if (platform === 'mac') return createMacAudioControl();

  return createRaspberryAudioControl();
}

/**
 * Used in `index.ts`.
 * Comes from the host, not from argv, so `npm run start:dev` on the Pi still
 * records with `arecord` instead of trying macOS AVFoundation.
 */
export function detectPlatform(): Platform {
  return isRaspberryPiOsHost() ? 'raspberry' : 'mac';
}

/**
 * Used in `index.ts` to read the mode argv from `npm start` / `npm run start:dev`.
 * `raspberry` and `mac` are the pre-`RunMode` names, still accepted so an already
 * installed systemd unit keeps working after a `git pull`.
 */
export function parseRunMode(
  value: string | undefined = process.argv[2],
): RunMode {
  if (value === 'prod' || value === 'raspberry') return 'prod';
  if (value === 'dev' || value === 'mac') return 'dev';

  throw new Error(
    'Pass "prod" (`npm start`) or "dev" (`npm run start:dev`) as the first argument',
  );
}
