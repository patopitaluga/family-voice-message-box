/**
 * Doorbell for the box: sounds when a family voice note arrives, so the child
 * notices from across the room instead of having to watch the play LED.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudioCommand } from './run-audio-command.ts';
import { tempPath } from './temp-dir.ts';
import type { AudioControl } from './type-audio-control.ts';

/** Resolved from this file, not the cwd, so systemd cannot miss it. */
const CHIME_SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'chimes.mp3');

let decodedChime: string | undefined;
let decodeFailed = false;
let sounding = false;

/**
 * Used in `playChime`.
 * `aplay` only takes WAV, so the mp3 is decoded once and the result reused.
 */
async function decodeChimeOnce(): Promise<string | undefined> {
  if (decodedChime !== undefined) return decodedChime;
  if (decodeFailed) return undefined;

  const wavPath = tempPath('chime.wav');
  try {
    await runAudioCommand('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      CHIME_SOURCE,
      wavPath,
    ]);
  } catch (error: unknown) {
    decodeFailed = true;
    console.warn(`No se pudo preparar ${CHIME_SOURCE}; la caja no sonará al recibir audios.`, error);
    return undefined;
  }

  decodedChime = wavPath;
  return wavPath;
}

/**
 * Used in `index.ts` when the play LED turns on.
 * Never throws and never overlaps itself: a chime that fails must not stop a
 * message from arriving.
 */
export async function playChime(audio: AudioControl): Promise<void> {
  if (sounding) return;

  sounding = true;
  try {
    const wavPath = await decodeChimeOnce();
    if (wavPath === undefined) return;

    await audio.play(wavPath);
  } catch (error: unknown) {
    console.warn('No se pudo reproducir el chime:', error);
  } finally {
    sounding = false;
  }
}
