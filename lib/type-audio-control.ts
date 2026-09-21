/**
 * Shared by `raspberry-audio.ts`, `mac-audio.ts`, `create-audio-control.ts`, and `index.ts`.
 * Grabación push-to-talk: `startRecording` / `stopRecording`; reproducción con `play`.
 */

/**
 * Used in `AudioControl.play`.
 * The Pi applies `loudnorm` in the same ffmpeg that talks to ALSA; Mac already
 * normalized when converting OGG → WAV, so it ignores this.
 * `gainDb` is for fixed assets that ship quieter than the voice notes, which
 * `loudnorm` cannot fix on a short clip without pumping.
 */
export type PlayAudioOptions = {
  normalizePlayback?: boolean;
  gainDb?: number;
};

/**
 * Used as the return type of `createMacAudioControl` and `createRaspberryAudioControl`,
 * and in `index.ts` / `chime.ts`.
 */
export type AudioControl = {
  readonly name: string;
  startRecording(outputPath: string): Promise<void>;
  stopRecording(): Promise<void>;
  play(filePath: string, options?: PlayAudioOptions): Promise<void>;
};
