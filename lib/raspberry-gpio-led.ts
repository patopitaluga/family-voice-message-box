/**
 * Drives a GPIO line as an LED using `gpioset` (from `gpiod`).
 * Used from `index.ts` (via `combineLeds`) for the record and play illuminated buttons.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { gpiosetHoldArgs } from './gpiod-cli.ts';
import type { Led } from './type-led.ts';

/**
 * Used in `createRaspberryGpioLed`.
 * The line is only driven while `gpioset` lives, so any exit we did not ask for
 * means the LED silently stayed off — the one failure mode impossible to debug
 * from the outside, since a dark LED looks exactly like bad wiring.
 */
function reportUnexpectedExit(
  chip: string,
  line: number,
  code: number | null,
  stderr: string,
): void {
  const where = `${chip} línea ${String(line)}`;
  const details = stderr.trim();

  if (code === 0) {
    console.error(
      `gpioset salió solo en ${where}: la línea se libera y el LED no queda encendido. ` +
        'Suele ser una versión de libgpiod que no mantiene el valor sin --hold-period.',
    );
    return;
  }

  console.error(
    details.length > 0
      ? `gpioset falló en ${where} (code=${String(code)}): ${details}`
      : `gpioset falló en ${where} (code=${String(code)}). ` +
          '¿El usuario está en el grupo gpio? ¿Existe el chip (GPIO_CHIP)?',
  );
}

/**
 * Used in `index.ts` for Raspberry illuminated buttons.
 * Keeps a `gpioset` process alive so the line stays driven.
 */
export function createRaspberryGpioLed(chip: string, line: number): Led {
  if (!Number.isInteger(line) || line < 0) throw new Error(`Invalid GPIO LED line: ${String(line)}`);

  let child: ChildProcess | undefined;
  /** `undefined` until the first `set`: the real line state is unknown at start. */
  let current: boolean | undefined;

  const stop = (): void => {
    if (child === undefined) return;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    child = undefined;
  };

  return {
    set(on: boolean): void {
      // Re-setting the same value would SIGTERM the live `gpioset` and start
      // another one: the line drops for a moment and the LED blinks.
      if (on === current) return;
      current = on;

      stop();
      const started = spawn('gpioset', gpiosetHoldArgs(chip, line, on), {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      child = started;

      let stderr = '';
      started.stderr?.setEncoding('utf8');
      started.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      started.once('error', (error) => {
        console.error(
          `gpioset failed for ${chip} line ${String(line)}. Is gpiod installed?`,
          error,
        );
      });

      started.once('exit', (code, signal) => {
        // We SIGTERM the previous process on every `set` and on `close`.
        if (signal !== null) return;

        // Nobody drives the line now, so the cached value is a lie: drop it or
        // the next `set` to the same value would be skipped and never recover.
        if (child === started) current = undefined;

        reportUnexpectedExit(chip, line, code, stderr);
      });
    },

    close(): void {
      current = undefined;
      stop();
    },
  };
}
