import type { ChildProcess } from 'node:child_process';
import type { AudioDevice } from './audio-device.ts';
import {
  runAudioCommand,
  startAudioProcess,
  stopAudioProcess,
} from './run-audio-command.ts';

/**
 * Used in `create-audio-device.ts` for `npm run start:dev` on macOS.
 * Records with ffmpeg (AVFoundation) and plays back with macOS `afplay`.
 */
export function createMacAudioDevice(): AudioDevice {
  let recording: ChildProcess | undefined;
  let recordingStderr = '';

  return {
    name: 'mac (ffmpeg / afplay)',

    async startRecording(outputPath: string): Promise<void> {
      if (recording) {
        throw new Error('Recording already in progress');
      }

      recordingStderr = '';
      const child = startAudioProcess(
        'ffmpeg',
        [
          '-y',
          '-loglevel',
          'error',
          '-f',
          'avfoundation',
          '-thread_queue_size',
          '1024',
          '-i',
          ':default',
          // Native capture, no filters / forced resampling (those caused crackle).
          '-c:a',
          'pcm_s16le',
          outputPath,
        ],
        { stdin: true },
      );

      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        recordingStderr += chunk;
      });

      recording = child;

      child.once('exit', (code, signal) => {
        if (recording === child) {
          recording = undefined;
        }

        if (code !== 0 && code !== null && signal === null) {
          const details = recordingStderr.trim();
          console.error(
            details.length > 0
              ? `ffmpeg exited early: ${details}`
              : `ffmpeg exited early (code=${String(code)})`,
          );
        }
      });

      // Fail fast if ffmpeg rejects the args / cannot open the mic.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, 300);

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
                ? `ffmpeg failed to start recording: ${details}`
                : `ffmpeg failed to start recording (code=${String(code)})`,
            ),
          );
        };

        const cleanup = (): void => {
          clearTimeout(timer);
          child.off('exit', onExit);
        };

        child.once('exit', onExit);
      });
    },

    async stopRecording(): Promise<void> {
      const child = recording;
      recording = undefined;

      if (!child) {
        return;
      }

      await stopAudioProcess(child);
    },

    async play(filePath: string): Promise<void> {
      await runAudioCommand('afplay', [filePath]);
    },
  };
}
