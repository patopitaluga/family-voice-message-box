import type { ChildProcess } from 'node:child_process';
import type { AudioDevice } from './audio-device.ts';
import {
  runAudioCommand,
  startAudioProcess,
  stopAudioProcess,
} from './run-audio-command.ts';

/**
 * Used in `create-audio-device.ts` for `npm start` on the Raspberry Pi.
 */
export function createRaspberryAudioDevice(): AudioDevice {
  let recording: ChildProcess | undefined;

  return {
    name: 'raspberry (arecord / aplay)',

    async startRecording(outputPath: string): Promise<void> {
      if (recording) {
        throw new Error('Recording already in progress');
      }

      recording = startAudioProcess('arecord', [
        '-f',
        'S16_LE',
        '-r',
        '44100',
        '-c',
        '1',
        '-t',
        'wav',
        outputPath,
      ]);

      recording.once('exit', () => {
        recording = undefined;
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
      await runAudioCommand('aplay', [filePath]);
    },
  };
}
