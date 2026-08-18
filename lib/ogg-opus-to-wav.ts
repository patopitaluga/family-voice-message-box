/**
 * Used before `AudioControl.play` for Telegram voice notes (OGG/Opus).
 * `aplay` / `afplay` need WAV; inbound files from Telegram are OGG.
 */
import { runAudioCommand } from './run-audio-command.ts';

/** Used in `index.ts` when playing a downloaded family voice. */
export async function convertOggOpusToWav(
  oggPath: string,
  wavPath: string = oggPath.replace(/\.ogg$/i, '.wav'),
): Promise<string> {
  await runAudioCommand('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    oggPath,
    wavPath,
  ]);

  return wavPath;
}
