import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { AudioControl } from './type-audio-control.ts';
import {
  runAudioCommand,
  startAudioProcess,
  stopAudioProcess,
} from './run-audio-command.ts';

const execFileAsync = promisify(execFile);

/**
 * Used in `index.ts` on `npm start`.
 * `arecord -l` lists capture cards; the Pi headphone jack is output-only.
 */
export async function warnIfNoAlsaCaptureDevice(): Promise<void> {
  let stdout: string;
  try {
    const result = await execFileAsync('arecord', ['-l'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    stdout = result.stdout;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.warn(
        'No se encontró `arecord`. Instala alsa-utils: sudo apt install -y alsa-utils',
      );
      return;
    }

    if (error && typeof error === 'object' && 'stdout' in error) stdout = String((error as { stdout?: string }).stdout ?? '');
     else {
      console.warn('No se pudo listar dispositivos de captura (`arecord -l`).', error);
      return;
    }
  }

  if (/^card\s+\d+:/m.test(stdout)) return;

  console.warn(
    'No hay micrófono de captura (`arecord -l` está vacío). ' +
      'El jack de auriculares de la Raspberry Pi no tiene entrada de micrófono. ' +
      'Enchufa un micrófono USB (u otro dispositivo de captura) y vuelve a ejecutar npm start.',
  );
}

/**
 * Used in `createRaspberryAudioControl`.
 * Optional `ALSA_DEVICE` (e.g. `plughw:1,0` from `arecord -l`).
 */
function arecordArgs(outputPath: string): string[] {
  const args = ['-f', 'S16_LE', '-r', '44100', '-c', '1'];
  const device = process.env.ALSA_DEVICE?.trim();
  if (device !== undefined && device !== '') args.push('-D', device);

  args.push('-t', 'wav', outputPath);
  return args;
}

/**
 * Used in `create-audio-control.ts` for `npm start` on the Raspberry Pi.
 */
export function createRaspberryAudioControl(): AudioControl {
  let recording: ChildProcess | undefined;
  let recordingStderr = '';

  return {
    name: 'raspberry (arecord / aplay)',

    async startRecording(outputPath: string): Promise<void> {
      if (recording) throw new Error('Recording already in progress');

      recordingStderr = '';
      const child = startAudioProcess('arecord', arecordArgs(outputPath));

      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        recordingStderr += chunk;
      });

      recording = child;

      child.once('exit', (code, signal) => {
        if (recording === child) recording = undefined;

        if (code !== 0 && code !== null && signal === null) {
          const details = recordingStderr.trim();
          console.error(
            details.length > 0
              ? `arecord exited early: ${details}`
              : `arecord exited early (code=${String(code)})`,
          );
        }
      });

      child.once('error', (error) => {
        if (recording === child) recording = undefined;
        console.error('arecord failed to start. Is alsa-utils installed?', error);
      });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, 400);

        const onSpawnError = (error: Error): void => {
          cleanup();
          reject(
            new Error(`Could not start arecord. Is alsa-utils installed?`, {
              cause: error,
            }),
          );
        };

        const onExit = (
          code: number | null,
          signal: NodeJS.Signals | null,
        ): void => {
          cleanup();
          if (signal !== null) {
            resolve();
            return;
          }

          const details = recordingStderr.trim();
          reject(
            new Error(
              details.length > 0
                ? `arecord failed to start recording: ${details}`
                : `arecord failed to start recording (code=${String(code)}). Try: arecord -l`,
            ),
          );
        };

        const cleanup = (): void => {
          clearTimeout(timer);
          child.off('exit', onExit);
          child.off('error', onSpawnError);
        };

        child.once('exit', onExit);
        child.once('error', onSpawnError);
      });
    },

    async stopRecording(): Promise<void> {
      const child = recording;
      recording = undefined;

      if (!child) return;

      await stopAudioProcess(child);
    },

    async play(filePath: string): Promise<void> {
      await runAudioCommand('aplay', [filePath]);
    },
  };
}
