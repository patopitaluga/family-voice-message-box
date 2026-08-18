/**
 * Shared by `raspberry-audio.ts`, `mac-audio.ts`, `create-audio-control.ts`, and `index.ts`.
 * Grabación push-to-talk: `startRecording` / `stopRecording`; reproducción con `play`.
 */
export type AudioControl = {
  readonly name: string;
  startRecording(outputPath: string): Promise<void>;
  stopRecording(): Promise<void>;
  play(filePath: string): Promise<void>;
};
