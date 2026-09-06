/**
 * Used before `AudioControl.play` for Telegram voice notes (OGG/Opus).
 * `aplay` / `afplay` need WAV; inbound files from Telegram are OGG.
 */
import { runAudioCommand } from './run-audio-command.ts';
import { isMissingFilter, playbackNormalizeArgs } from './audio-normalize.ts';

/** Used in `convertOggOpusToWav`. */
function decodeArgs(
  oggPath: string,
  wavPath: string,
  filterArgs: string[],
): string[] {
  return ['-y', '-loglevel', 'error', '-i', oggPath, ...filterArgs, wavPath];
}

/** Used in `index.ts` when playing a downloaded family voice. */
export async function convertOggOpusToWav(
  oggPath: string,
  wavPath: string = oggPath.replace(/\.ogg$/i, '.wav'),
): Promise<string> {
  const filterArgs = playbackNormalizeArgs();

  try {
    await runAudioCommand('ffmpeg', decodeArgs(oggPath, wavPath, filterArgs));
  } catch (error: unknown) {
    if (filterArgs.length === 0 || !isMissingFilter(error)) throw error;

    console.warn(
      'Este ffmpeg no tiene `loudnorm`: se reproduce sin normalizar el volumen.',
    );
    await runAudioCommand('ffmpeg', decodeArgs(oggPath, wavPath, []));
  }

  return wavPath;
}
