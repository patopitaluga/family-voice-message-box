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
  signal: NodeJS.Signals | null,
  stderr: string,
): void {
  const where = `${chip} línea ${String(line)}`;
  const details = stderr.trim();

  if (signal !== null) {
    console.error(
      `gpioset recibió ${signal} en ${where} sin que se lo pidiéramos: la línea queda ` +
        'liberada y el LED apagado. Busca quién lo mató en el journal del kernel ' +
        '(OOM, caídas de tensión): journalctl -k -b',
    );
    return;
  }

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
  /** `undefined` whenever nobody drives the line, so the next `set` always acts. */
  let current: boolean | undefined;
  /** Their exit is ours (a `set` replacing them, or `close`), not something to report. */
  const killedByUs = new WeakSet<ChildProcess>();

  /** True only while a `gpioset` is alive and therefore really holding the line. */
  const holding = (): boolean =>
    child !== undefined && child.exitCode === null && child.signalCode === null;

  /**
   * Nobody drives the line once its process is gone, so the cached value becomes
   * a claim we cannot back: drop it, or every later `set` to that same value
   * would be skipped and the LED would never light again.
   */
  const forget = (gone: ChildProcess): void => {
    if (child !== gone) return;
    child = undefined;
    current = undefined;
  };

  const stop = (): void => {
    if (child === undefined) return;
    if (child.exitCode === null && child.signalCode === null) {
      killedByUs.add(child);
      child.kill('SIGTERM');
    }

    child = undefined;
  };

  return {
    set(on: boolean): void {
      // Re-setting a value a live `gpioset` already holds would SIGTERM it and
      // start another one: the line drops for a moment and the LED blinks.
      if (on === current && holding()) return;

      if (on === current) console.warn(
          `LED ${chip}:${String(line)}: la caché decía ${on ? '1' : '0'} pero ningún ` +
            'gpioset sostenía la línea. Se relanza.',
        );

      current = on;

      stop();
      const started = spawn('gpioset', gpiosetHoldArgs(chip, line, on), {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      child = started;
      console.log(
        `gpioset ${chip} ${String(line)}=${on ? '1' : '0'} (pid ${String(started.pid ?? 0)})`,
      );

      let stderr = '';
      started.stderr?.setEncoding('utf8');
      started.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      started.once('error', (error) => {
        forget(started);
        console.error(
          `gpioset failed for ${chip} line ${String(line)}. Is gpiod installed?`,
          error,
        );
      });

      started.once('exit', (code, signal) => {
        forget(started);

        // Anything else killing it leaves the LED dark with nothing in the log,
        // which is the one failure we cannot tell apart from bad wiring.
        if (signal !== null && killedByUs.has(started)) return;

        reportUnexpectedExit(chip, line, code, signal, stderr);
      });
    },

    close(): void {
      current = undefined;
      stop();
    },
  };
}
