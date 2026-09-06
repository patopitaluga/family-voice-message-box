/**
 * ffmpeg loudness filters for both conversions.
 * The ALSA mixer sets one fixed gain, but a child speaks from a different
 * distance every time and family voice notes arrive at wildly different levels,
 * so the per-clip level has to be fixed in software too.
 */

/** Used in `speechNormalizeArgs`. Levels speech recorded at a varying distance. */
const SPEECH_FILTER = 'speechnorm=e=12.5:r=0.0001:l=1';

/** Used in `playbackNormalizeArgs`. EBU R128 target, the usual one for voice. */
const PLAYBACK_FILTER = 'loudnorm=I=-14:TP=-1.5:LRA=11';

/** Used in `speechNormalizeArgs` and `playbackNormalizeArgs`. */
function filterArgs(filter: string): string[] {
  const setting = process.env.AUDIO_NORMALIZE?.trim().toLowerCase();
  if (setting === 'off' || setting === 'false' || setting === '0') return [];

  return ['-af', filter];
}

/** Used in `wav-to-ogg-opus.ts` for the outbound recording. */
export function speechNormalizeArgs(): string[] {
  return filterArgs(SPEECH_FILTER);
}

/** Used in `ogg-opus-to-wav.ts` for inbound family voice notes. */
export function playbackNormalizeArgs(): string[] {
  return filterArgs(PLAYBACK_FILTER);
}

/**
 * Used in `wav-to-ogg-opus.ts` and `ogg-opus-to-wav.ts`.
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
