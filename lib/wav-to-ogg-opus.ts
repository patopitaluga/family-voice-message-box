import { runAudioCommand } from './run-audio-command.ts';

/**
 * Used in `index.ts` and previously `send-last-tg.ts` before `tgSendVoice`.
 * Writes an OGG/Opus file next to the WAV (or to `oggPath` when provided).
 */
export async function convertWavToOggOpus(
  wavPath: string,
  oggPath: string = wavPath.replace(/\.wav$/i, '.ogg'),
): Promise<string> {
  await runAudioCommand('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    wavPath,
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

  return oggPath;
}
