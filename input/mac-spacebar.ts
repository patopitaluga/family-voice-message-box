import { chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { GlobalKeyboardListener } from 'node-global-key-listener';
import type { HoldToTalkHandlers, StopListening } from './hold-to-talk.ts';

const require = createRequire(import.meta.url);

/**
 * Used in `listenToMacSpacebar`.
 * npm does not reliably keep the +x bit on MacKeyServer; without it the library
 * falls into broken `sudo-prompt` code on Node 24.
 */
async function ensureMacKeyServerExecutable(): Promise<string> {
  const packageJsonPath = require.resolve('node-global-key-listener/package.json');
  const serverPath = path.join(path.dirname(packageJsonPath), 'bin', 'MacKeyServer');
  await chmod(serverPath, 0o755);
  return serverPath;
}

/**
 * Used in `listen-for-hold.ts` for `npm run start:dev`.
 * Hold space to talk, release to stop; `p` plays the latest recording.
 * Uses OS key-up/key-down (not the terminal), so macOS key-repeat cannot
 * fake extra presses. Needs Accessibility permission on macOS.
 */
export async function listenToMacSpacebar(
  handlers: HoldToTalkHandlers,
): Promise<StopListening> {
  const serverPath = await ensureMacKeyServerExecutable();

  const keyboard = new GlobalKeyboardListener({
    mac: {
      serverPath,
      onError: (errorCode) => {
        console.error(`Keyboard listener error: ${String(errorCode)}`);
      },
    },
  });

  let held = false;
  let pressInFlight = false;
  let releaseWhilePressInFlight = false;
  let playInFlight = false;

  const listener = (event: { name?: string; state: 'DOWN' | 'UP' }): void => {
    if (event.name === 'P' && event.state === 'DOWN') {
      if (held || pressInFlight || playInFlight || !handlers.onPlayLast) {
        return;
      }

      playInFlight = true;
      void Promise.resolve(handlers.onPlayLast())
        .catch((error: unknown) => {
          console.error(error);
        })
        .finally(() => {
          playInFlight = false;
        });
      return;
    }

    if (event.name !== 'SPACE') {
      return;
    }

    if (event.state === 'DOWN') {
      if (held || playInFlight) {
        return;
      }

      held = true;
      pressInFlight = true;
      void Promise.resolve(handlers.onPress())
        .catch((error: unknown) => {
          console.error(error);
        })
        .finally(() => {
          pressInFlight = false;
          if (releaseWhilePressInFlight) {
            releaseWhilePressInFlight = false;
            held = false;
            void Promise.resolve(handlers.onRelease()).catch(
              (error: unknown) => {
                console.error(error);
              },
            );
          }
        });
      return;
    }

    if (event.state === 'UP') {
      if (!held) {
        return;
      }

      if (pressInFlight) {
        releaseWhilePressInFlight = true;
        return;
      }

      held = false;
      void Promise.resolve(handlers.onRelease()).catch((error: unknown) => {
        console.error(error);
      });
    }
  };

  try {
    await keyboard.addListener(listener);
  } catch (error) {
    keyboard.kill();
    throw new Error(
      'Could not listen for the spacebar. On macOS, enable Accessibility for your terminal (or Cursor) in System Settings → Privacy & Security → Accessibility, then run again.',
      { cause: error },
    );
  }

  // Swallow typed characters in this terminal; keep Ctrl+C working.
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (chunk: Buffer) => {
      if (chunk[0] === 3) {
        stop();
        process.exit(0);
      }
    });
  }

  const stop: StopListening = () => {
    keyboard.removeListener(listener);
    keyboard.kill();

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  };

  return stop;
}
