import { spawn, type ChildProcess } from 'node:child_process';
import type { HoldToTalkHandlers, StopListening } from './hold-to-talk.ts';

/**
 * Used in `index.ts` for `npm start` on the Raspberry Pi.
 * Watches a GPIO line with `gpiomon` (from `gpiod`). Default: active-low button
 * (press = falling edge, release = rising edge).
 */
export function listenToRaspberryButton(
  handlers: HoldToTalkHandlers,
  options?: {
    chip?: string;
    line?: number;
  },
): StopListening {
  const chip = options?.chip ?? process.env.GPIO_CHIP ?? 'gpiochip0';
  const line = options?.line ?? Number(process.env.GPIO_LINE ?? '17');

  if (!Number.isInteger(line) || line < 0) throw new Error(`Invalid GPIO_LINE: ${String(process.env.GPIO_LINE)}`);

  let child: ChildProcess;
  try {
    child = spawn(
      'gpiomon',
      ['--format=%e', chip, String(line)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    throw new Error(
      `Could not start gpiomon for ${chip} line ${String(line)}. Is gpiod installed?`,
      { cause: error },
    );
  }

  let busy = false;
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

      const pressed = edge === '0' || edge === 'falling';
      const released = edge === '1' || edge === 'rising';
      if (!pressed && !released) continue;

      if (busy) continue;

      busy = true;
      const run = pressed ? handlers.onPress : handlers.onRelease;
      void Promise.resolve(run()).finally(() => {
        busy = false;
      });
    }
  });

  return () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');

  };
}
