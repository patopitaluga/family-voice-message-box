/**
 * Shared by `raspberry-audio.ts`, `mac-audio.ts`, `create-audio-device.ts`, and `index.ts`.
 * Grabación push-to-talk: `startRecording` / `stopRecording`; reproducción con `play`.
 */
export type AudioDevice = {
  readonly name: string;
  startRecording(outputPath: string): Promise<void>;
  stopRecording(): Promise<void>;
  play(filePath: string): Promise<void>;
};
