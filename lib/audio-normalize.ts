/**
 * ffmpeg loudness filters for recording and playback.
 * The ALSA mixer sets one fixed gain, but a child speaks from a different
 * distance every time and family voice notes arrive at wildly different levels,
 * so the per-clip level has to be fixed in software too.
 */
import type { PlayAudioOptions } from './type-audio-control.ts';

/** Used in `speechNormalizeArgs`. Levels speech recorded at a varying distance. */
const SPEECH_FILTER = 'speechnorm=e=12.5:r=0.0001:l=1';

/** Used in `playbackNormalizeArgs`. EBU R128 target, the usual one for voice. */
const PLAYBACK_FILTER = 'loudnorm=I=-14:TP=-1.5:LRA=11';

/** Used in `filterArgs` and `playbackFilterArgs`. */
function normalizeDisabled(): boolean {
  const setting = process.env.AUDIO_NORMALIZE?.trim().toLowerCase();
  return setting === 'off' || setting === 'false' || setting === '0';
}

/** Used in `speechNormalizeArgs` and `playbackNormalizeArgs`. */
function filterArgs(filter: string): string[] {
  return normalizeDisabled() ? [] : ['-af', filter];
}

/** Used in `wav-to-ogg-opus.ts` for outbound recordings. */
export function speechNormalizeArgs(): string[] {
  return filterArgs(SPEECH_FILTER);
}

/** Used in `ogg-opus-to-wav.ts` for inbound family voices. */
export function playbackNormalizeArgs(): string[] {
  return filterArgs(PLAYBACK_FILTER);
}

/**
 * Used in `raspberry-audio.ts` for everything the box plays out loud.
 * ffmpeg keeps only the last `-af`, so both filters have to travel in one chain.
 * `AUDIO_NORMALIZE=off` drops `loudnorm` but keeps the gain: that switch is there
 * to avoid loudnorm artifacts, not to make a quiet asset inaudible again.
 * `volume` is a core filter, so it never needs the `isMissingFilter` fallback.
 */
export function playbackFilterArgs(options?: PlayAudioOptions): string[] {
  const filters: string[] = [];

  if (options?.normalizePlayback === true && !normalizeDisabled()) filters.push(PLAYBACK_FILTER);

  const gain = options?.gainDb ?? 0;
  if (gain !== 0) filters.push(`volume=${String(gain)}dB`);

  return filters.length === 0 ? [] : ['-af', filters.join(',')];
}

/**
 * Used in `wav-to-ogg-opus.ts`, `ogg-opus-to-wav.ts`, and `raspberry-audio.ts`.
 * Older ffmpeg builds lack `speechnorm`; the message still has to get through.
 */
export function isMissingFilter(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /no such filter/i.test(message) ||
    /unknown filter/i.test(message) ||
    /error initializing (?:complex )?filter/i.test(message)
  );
}
