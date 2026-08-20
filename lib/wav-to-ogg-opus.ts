import { runAudioCommand } from './run-audio-command.ts';

/**
 * Used in `convertWavToOggOpus`.
 * Raspberry Pi OS ffmpeg sometimes has native `opus` but not `libopus`.
 */
function isMissingLibopus(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown encoder ['"]libopus['"]/i.test(message) || /encoder ['"]libopus['"] not found/i.test(message);
}

/**
 * Used in `index.ts` and previously `send-last-tg.ts` before `tgSendVoice`.
 * Writes an OGG/Opus file next to the WAV (or to `oggPath` when provided).
 */
export async function convertWavToOggOpus(
  wavPath: string,
  oggPath: string = wavPath.replace(/\.wav$/i, '.ogg'),
): Promise<string> {
  const common = ['-y', '-loglevel', 'error', '-i', wavPath];

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

  return oggPath;
}
