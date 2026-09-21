/**
 * Doorbell for the box: sounds when a family voice note arrives, so the child
 * notices from across the room instead of having to watch the play LED.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AudioControl } from './type-audio-control.ts';

/** Resolved from this file, not the cwd, so systemd cannot miss it. */
const CHIME_SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'chimes.mp3');

/**
 * Used in `playChime`.
 * The file is mastered at -27 LUFS while family voices come out at -14, so it
 * arrived 13 dB below everything else the box plays. It peaks at -16 dBFS, so
 * this much gain still lands 3 dB short of clipping.
 */
const CHIME_GAIN_DB = 13;

let sounding = false;
let playFailed = false;

/**
 * Used in `index.ts` when the play LED turns on.
 * Never throws and never overlaps itself: a chime that fails must not stop a
 * message from arriving. ffmpeg (Pi) and afplay (Mac) both play the mp3 directly.
 */
export async function playChime(audio: AudioControl): Promise<void> {
  if (sounding || playFailed) return;

  sounding = true;
  try {
    await audio.play(CHIME_SOURCE, { gainDb: CHIME_GAIN_DB });
  } catch (error: unknown) {
    playFailed = true;
    console.warn(
      `No se pudo reproducir ${CHIME_SOURCE}; la caja no sonará al recibir audios.`,
      error,
    );
  } finally {
    sounding = false;
  }
}
