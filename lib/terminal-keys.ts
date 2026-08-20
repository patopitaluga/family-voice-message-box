/**
 * Terminal stand-in for GPIO buttons when `npm start` runs in a TTY (SSH).
 * Used from `index.ts` on Raspberry Pi so you can test without wiring buttons.
 */
import type { HoldToTalkHandlers, StopListening } from './hold-to-talk.ts';

const CTRL_C = 3;
const SPACE = 32;
const KEY_P = 80;
const KEY_P_LOWER = 112;
/** Ignore key-repeat; a gap means the key was released. */
const REPEAT_GUARD_MS = 400;

/**
 * Used in `index.ts` for `npm start` on Raspberry Pi.
 * Space toggles record/send (a terminal has no key-up, unlike Mac hold-to-talk).
 * `p` plays. No-op when stdin is not a TTY (systemd).
 */
export function listenToTerminalKeys(
  handlers: HoldToTalkHandlers,
): StopListening {
  if (!process.stdin.isTTY) return () => undefined;

  process.stdin.setRawMode(true);
  process.stdin.resume();

  let recording = false;
  let ignoringRepeat = false;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let pressInFlight = false;
  let releaseInFlight = false;
  let playInFlight = false;

  const markRepeat = (): void => {
    ignoringRepeat = true;
    if (quietTimer !== undefined) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      ignoringRepeat = false;
      quietTimer = undefined;
    }, REPEAT_GUARD_MS);
  };

  const onData = (chunk: Buffer): void => {
    for (const byte of chunk) {
      if (byte === CTRL_C) {
        process.kill(process.pid, 'SIGINT');
        return;
      }

      if (byte === KEY_P || byte === KEY_P_LOWER) {
        if (recording || pressInFlight || playInFlight || handlers.onPlayLast === undefined) continue;

        playInFlight = true;
        void Promise.resolve(handlers.onPlayLast())
          .catch((error: unknown) => {
            console.error(error);
          })
          .finally(() => {
            playInFlight = false;
          });
        continue;
      }

      if (byte !== SPACE) continue;
      if (ignoringRepeat) {
        markRepeat();
        continue;
      }

      if (pressInFlight || releaseInFlight || playInFlight) continue;

      markRepeat();

      if (!recording) {
        recording = true;
        pressInFlight = true;
        void Promise.resolve(handlers.onPress())
          .catch((error: unknown) => {
            console.error(error);
          })
          .finally(() => {
            pressInFlight = false;
          });
        continue;
      }

      recording = false;
      releaseInFlight = true;
      void Promise.resolve(handlers.onRelease())
        .catch((error: unknown) => {
          console.error(error);
        })
        .finally(() => {
          releaseInFlight = false;
        });
    }
  };

  process.stdin.on('data', onData);

  return () => {
    process.stdin.off('data', onData);
    if (quietTimer !== undefined) clearTimeout(quietTimer);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  };
}
