import { execFileSync } from 'node:child_process';

/** Used in `gpiomonWatchArgs` and `gpiosetHoldArgs`. */
export type GpiodCliMajor = 1 | 2;

let cachedMajor: GpiodCliMajor | undefined;

/**
 * Used in `gpiomonWatchArgs` and `gpiosetHoldArgs`.
 * Raspberry Pi OS Bookworm ships libgpiod 1 (`gpiomon <chip> <line>`);
 * Trixie ships 2 (`gpiomon --chip <chip> <line>`).
 */
export function detectGpiodCliMajor(): GpiodCliMajor {
  if (cachedMajor !== undefined) return cachedMajor;

  let help = '';
  try {
    help = execFileSync('gpiomon', ['--help'], {
      encoding: 'utf8',
      timeout: 3000,
    });
  } catch (error: unknown) {
    if (error && typeof error === 'object') {
      const spawned = error as { stdout?: string; stderr?: string };
      help = `${spawned.stdout ?? ''}${spawned.stderr ?? ''}`;
    }
  }

  cachedMajor = help.includes('--chip') ? 2 : 1;
  return cachedMajor;
}

/**
 * Used in `raspberry-button.ts`.
 * Watch one line (active-low + pull-up). Output is falling/rising or 0/1.
 */
export function gpiomonWatchArgs(chip: string, line: number): string[] {
  if (detectGpiodCliMajor() === 2) return ['--bias=pull-up', '--format=%E', '--chip', chip, String(line)];

  return ['--bias=pull-up', '--format=%e', chip, String(line)];
}

/**
 * Used in `raspberry-gpio-led.ts`.
 * Holds the line until the `gpioset` process is killed.
 */
export function gpiosetHoldArgs(
  chip: string,
  line: number,
  on: boolean,
): string[] {
  const assignment = `${String(line)}=${on ? '1' : '0'}`;
  if (detectGpiodCliMajor() === 2) return ['--chip', chip, assignment];

  return ['--mode=signal', chip, assignment];
}
