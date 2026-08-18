/**
 * Drives a GPIO line as an LED using `gpioset --mode=signal` (from `gpiod`).
 * Used from `index.ts` (via `combineLeds`) for the record and play illuminated buttons.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { Led } from './type-led.ts';

/**
 * Used in `index.ts` for Raspberry illuminated buttons.
 * Keeps a `gpioset` process alive so the line stays driven.
 */
export function createRaspberryGpioLed(chip: string, line: number): Led {
  if (!Number.isInteger(line) || line < 0) throw new Error(`Invalid GPIO LED line: ${String(line)}`);

  let child: ChildProcess | undefined;

  const stop = (): void => {
    if (child === undefined) return;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    child = undefined;
  };

  return {
    set(on: boolean): void {
      stop();
      child = spawn(
        'gpioset',
        ['--mode=signal', chip, `${String(line)}=${on ? '1' : '0'}`],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      child.once('error', (error) => {
        console.error(
          `gpioset failed for ${chip} line ${String(line)}. Is gpiod installed?`,
          error,
        );
      });
    },

    close(): void {
      stop();
    },
  };
}
