/**
 * Terminal stand-in for GPIO buttons when `npm start` runs in a TTY (SSH).
 * Used from `index.ts` on Raspberry Pi so you can test without wiring buttons.
 *
 * Hold-to-talk vs a TTY (why the timers exist)
 * --------------------------------------------
 * GPIO buttons (`gpiomon`) report press and release as falling/rising edges.
 * A terminal does not: stdin is a stream of characters, with no key-up.
 *
 * Holding space is not one event. The OS waits ~500ms ("delay until repeat")
 * then emits more ` ` bytes. This code infers "still held" from that stream:
 * another space soon → still down; a gap → treat as release. That is a hold
 * detector, not switch debouncing (debouncing ignores extra electrical edges
 * from one physical click).
 *
 * `FIRST_REPEAT_GRACE_MS` must exceed that initial delay, or the first repeat
 * looks like a new press and recording stops at ~0.5s. After repeats are
 * systemd has no TTY; this path does not run there. `index.ts` only uses this
 * when `listenToLinuxKeyboard` cannot open an evdev device.
 */
import type { HoldToTalkHandlers, StopListening } from './hold-to-talk.ts';

const CTRL_C = 3;
const SPACE = 32;
const KEY_P = 80;
const KEY_P_LOWER = 112;
/** See file comment: wait out OS "delay until repeat" before assuming release. */
const FIRST_REPEAT_GRACE_MS = 1500;
/** See file comment: gap between key-repeat spaces once the key is clearly held. */
const HELD_RELEASE_MS = 80;

/**
 * Used in `index.ts` for `npm start` on Raspberry Pi.
 * Hold space to record; `p` plays. No-op when stdin is not a TTY (systemd).
 * Why space uses timers: see the file comment (TTY has no key-up).
 */
export function listenToTerminalKeys(
  handlers: HoldToTalkHandlers,
): StopListening {
  if (!process.stdin.isTTY) return () => undefined;

  process.stdin.setRawMode(true);
  process.stdin.resume();

  let held = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let pressInFlight = false;
  let releaseWhilePressInFlight = false;
  let playInFlight = false;

  const clearReleaseTimer = (): void => {
    if (releaseTimer === undefined) return;
    clearTimeout(releaseTimer);
    releaseTimer = undefined;
  };

  const finishRelease = (): void => {
    held = false;
    void Promise.resolve(handlers.onRelease()).catch((error: unknown) => {
      console.error(error);
    });
  };

  const armRelease = (ms: number): void => {
    clearReleaseTimer();
    releaseTimer = setTimeout(() => {
      releaseTimer = undefined;
      if (!held) return;

      if (pressInFlight) {
        releaseWhilePressInFlight = true;
        return;
      }

      finishRelease();
    }, ms);
  };

  const onData = (chunk: Buffer): void => {
    for (const byte of chunk) {
      if (byte === CTRL_C) {
        process.kill(process.pid, 'SIGINT');
        return;
      }

      if (byte === KEY_P || byte === KEY_P_LOWER) {
        if (held || pressInFlight || playInFlight || handlers.onPlayLast === undefined) continue;

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
      if (playInFlight) continue;

      if (!held) {
        held = true;
        pressInFlight = true;
        armRelease(FIRST_REPEAT_GRACE_MS);
        void Promise.resolve(handlers.onPress())
          .catch((error: unknown) => {
            console.error(error);
          })
          .finally(() => {
            pressInFlight = false;
            if (releaseWhilePressInFlight) {
              releaseWhilePressInFlight = false;
              finishRelease();
            }
          });
        continue;
      }

      armRelease(HELD_RELEASE_MS);
    }
  };

  process.stdin.on('data', onData);

  return () => {
    process.stdin.off('data', onData);
    clearReleaseTimer();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  };
}
