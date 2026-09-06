import { runAudioCommand } from './run-audio-command.ts';
import { isMissingFilter, speechNormalizeArgs } from './audio-normalize.ts';

/**
 * Used in `encodeOpus`.
 * Raspberry Pi OS ffmpeg sometimes has native `opus` but not `libopus`.
 */
function isMissingLibopus(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown encoder ['"]libopus['"]/i.test(message) || /encoder ['"]libopus['"] not found/i.test(message);
}

/** Used in `convertWavToOggOpus`. */
async function encodeOpus(
  wavPath: string,
  oggPath: string,
  filterArgs: string[],
): Promise<void> {
  const common = ['-y', '-loglevel', 'error', '-i', wavPath, ...filterArgs];

  try {
    await runAudioCommand('ffmpeg', [
      ...common,
      '-c:a',
      'libopus',
      '-b:a',
      '48k',
      '-vbr',
      'on',
      '-application',
      'voip',
      oggPath,
    ]);
  } catch (error: unknown) {
    if (!isMissingLibopus(error)) throw error;

    await runAudioCommand('ffmpeg', [
      ...common,
      '-c:a',
      'opus',
      '-b:a',
      '48k',
      '-strict',
      '-2',
      oggPath,
    ]);
  }
}

/**
 * Used in `index.ts` and previously `send-last-tg.ts` before `tgSendVoice`.
 * Writes an OGG/Opus file next to the WAV (or to `oggPath` when provided).
 */
export async function convertWavToOggOpus(
  wavPath: string,
  oggPath: string = wavPath.replace(/\.wav$/i, '.ogg'),
): Promise<string> {
  const filterArgs = speechNormalizeArgs();

  try {
    await encodeOpus(wavPath, oggPath, filterArgs);
  } catch (error: unknown) {
    if (filterArgs.length === 0 || !isMissingFilter(error)) throw error;

    console.warn(
      'Este ffmpeg no tiene `speechnorm`: se envía sin normalizar el volumen.',
    );
    await encodeOpus(wavPath, oggPath, []);
  }

  return oggPath;
}
