/**
 * Shared by `mac-spacebar.ts` and `raspberry-button.ts`.
 * `onPress` / `onRelease` are push-to-talk (hold one control while speaking).
 * `onPlayLast` is optional Mac-only debug playback (`p` key).
 */
export type HoldToTalkHandlers = {
  onPress: () => void | Promise<void>;
  onRelease: () => void | Promise<void>;
  onPlayLast?: () => void | Promise<void>;
};

/**
 * Shared by `mac-spacebar.ts` and `raspberry-button.ts`.
 * Call to detach listeners and free OS resources.
 */
export type StopListening = () => void;
