/**
 * Shared by `mac-spacebar.ts`, `raspberry-button.ts`, `linux-keyboard.ts`, and `terminal-keys.ts`.
 * `onPress` / `onRelease` are push-to-talk (hold one control while speaking).
 * `onPlayLast` plays the latest audio (Mac `p` key, Linux `p`, terminal `p`, or Raspberry play button).
 */
export type HoldToTalkHandlers = {
  onPress: () => void | Promise<void>;
  onRelease: () => void | Promise<void>;
  onPlayLast?: () => void | Promise<void>;
  /**
   * Both edges of the play button, for lighting its LED while held.
   * Synchronous and never queued: the LED must follow the finger, not the audio.
   */
  onPlayHeld?: (pressed: boolean) => void;
};

/**
 * Shared by `mac-spacebar.ts`, `raspberry-button.ts`, `linux-keyboard.ts`, and `terminal-keys.ts`.
 * Call to detach listeners and free OS resources.
 */
export type StopListening = () => void;
