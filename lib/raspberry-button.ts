/**
 * Raspberry Pi physical controls: hold-to-talk record button and play button
 * (both watched with `gpiomon`, active-low + internal pull-up).
 * Used from `index.ts` for `npm start`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { gpiomonWatchArgs } from './gpiod-cli.ts';
import type { HoldToTalkHandlers, StopListening } from './hold-to-talk.ts';

/**
 * Used in `watchActiveLowButton`.
 * Cheap switches chatter for a few milliseconds while held; releases shorter
 * than this are ignored so the play LED does not flicker under the finger.
 */
const BUTTON_HOLD_DEBOUNCE_MS = 80;

/** Used in `listenToRaspberryButtons`. */
export type RaspberryButtonLines = {
  chip?: string;
  /** BCM line for hold-to-talk (default 17, or `GPIO_RECORD_BUTTON` / `GPIO_LINE`). */
  recordButton?: number;
  /** BCM line for play-last press (default 22, or `GPIO_PLAY_BUTTON`). */
  playButton?: number;
};

/**
 * Used in `watchActiveLowButton`.
 * Press is forwarded immediately; a release only sticks if it lasts `settleMs`
 * without another press, so bounce gaps do not flicker the LED or retrigger handlers.
 */
function ignoreBriefReleases(
  settleMs: number,
  emit: (pressed: boolean) => void,
): { next: (pressed: boolean) => void; cancel: () => void } {
  let held = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;

  return {
    next(pressed: boolean) {
      if (pressed) {
        if (releaseTimer !== undefined) {
          clearTimeout(releaseTimer);
          releaseTimer = undefined;
        }
        if (!held) {
          held = true;
          emit(true);
        }
        return;
      }

      if (!held || releaseTimer !== undefined) return;

      releaseTimer = setTimeout(() => {
        releaseTimer = undefined;
        held = false;
        emit(false);
      }, settleMs);
    },
    cancel() {
      if (releaseTimer === undefined) return;
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
    },
  };
}

/**
 * Used in `listenToRaspberryButtons`.
 * Watches one active-low GPIO line; `onPress` / `onRelease` are optional.
 */
function watchActiveLowButton(
  chip: string,
  line: number,
  handlers: {
    onPress?: () => void | Promise<void>;
    onRelease?: () => void | Promise<void>;
    /** Press is raw (LED now); release is settled. Always before the busy gate. */
    onEdge?: (pressed: boolean) => void;
  },
): StopListening {
  if (!Number.isInteger(line) || line < 0) throw new Error(`Invalid GPIO button line: ${String(line)}`);

  let busy = false;
  let queued: boolean | undefined;

  /**
   * Used from the debounce and the busy-queue flush.
   * LED-off is debounced with the release; LED-on is already fired on the raw press.
   */
  const runSettled = (pressed: boolean): void => {
    if (!pressed) handlers.onEdge?.(false);

    const run = pressed ? handlers.onPress : handlers.onRelease;
    if (run === undefined) return;
    if (busy) {
      queued = pressed;
      return;
    }

    busy = true;
    void Promise.resolve(run())
      .catch((error: unknown) => {
        console.error(error);
      })
      .finally(() => {
        busy = false;
        if (queued === undefined) return;
        const next = queued;
        queued = undefined;
        runSettled(next);
      });
  };

  const debounce = ignoreBriefReleases(BUTTON_HOLD_DEBOUNCE_MS, runSettled);

  let child: ChildProcess;
  try {
    child = spawn('gpiomon', gpiomonWatchArgs(chip, line), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(
      `Could not start gpiomon for ${chip} line ${String(line)}. Is gpiod installed?`,
      { cause: error },
    );
  }

  let stderr = '';

  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });

  child.once('error', (error) => {
    console.error(
      `gpiomon failed for ${chip} line ${String(line)}. Is gpiod installed?`,
      error,
    );
  });

  child.once('exit', (code, signal) => {
    if (code !== 0 && code !== null) console.error(
        `gpiomon exited (code=${String(code)}, signal=${String(signal)}): ${stderr.trim()}`,
      );

  });

  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    for (const rawLine of chunk.split('\n')) {
      const edge = rawLine.trim().toLowerCase();
      if (edge === '') continue;

      const pressed = edge === '0' || edge === '2' || edge === 'falling';
      const released = edge === '1' || edge === 'rising';
      if (!pressed && !released) continue;

      if (pressed) handlers.onEdge?.(true);
      debounce.next(pressed);
    }
  });

  return () => {
    debounce.cancel();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  };
}

/** Used when reading env defaults for button BCM lines. */
function readLineEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return value;
}

/**
 * Used in `index.ts` for `npm start`.
 * Record button: hold = press/release. Play button: press triggers `onPlayLast`.
 */
export function listenToRaspberryButtons(
  handlers: HoldToTalkHandlers,
  options?: RaspberryButtonLines,
): StopListening {
  const chip = options?.chip ?? process.env.GPIO_CHIP ?? 'gpiochip0';
  const recordButton =
    options?.recordButton ??
    readLineEnv(
      'GPIO_RECORD_BUTTON',
      readLineEnv('GPIO_LINE', 17),
    );
  const playButton =
    options?.playButton ?? readLineEnv('GPIO_PLAY_BUTTON', 22);

  const stopRecord = watchActiveLowButton(chip, recordButton, {
    onPress: handlers.onPress,
    onRelease: handlers.onRelease,
    onEdge: handlers.onRecordHeld,
  });

  const stopPlay = watchActiveLowButton(chip, playButton, {
    onPress: handlers.onPlayLast,
    onEdge: handlers.onPlayHeld,
  });

  return () => {
    stopRecord();
    stopPlay();
  };
}
