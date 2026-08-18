/**
 * Shared by `mac-spacebar.ts` and `raspberry-button.ts`.
 * `onPress` / `onRelease` are push-to-talk (hold one control while speaking).
 * `onPlayLast` plays the latest audio (Mac `p` key or Raspberry play button).
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
