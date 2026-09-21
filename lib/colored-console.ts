/**
 * Makes failures stand out in whatever is reading the output.
 * In a terminal that means ANSI colour; under systemd there is no terminal, so
 * it means the syslog priority prefix that makes `journalctl` paint the line red
 * (and makes `journalctl -p err` able to list only these).
 */
import { formatWithOptions } from 'node:util';

const RED = '\u001B[31m';
const YELLOW = '\u001B[33m';
const DEFAULT_COLOR = '\u001B[39m';

/** Syslog `err`, read and stripped by systemd (`SyslogLevelPrefix`, on by default). */
const LEVEL_ERR = '<3>';
/** Syslog `warning`. */
const LEVEL_WARNING = '<4>';

/**
 * Used in `installColoredConsole`.
 * Every line needs its own prefix: systemd reads the priority per line, so a
 * multi-line stack trace would otherwise arrive as one red line and the rest plain.
 */
function prefixLines(text: string, level: string): string {
  return text
    .split('\n')
    .map((line) => `${level}${line}`)
    .join('\n');
}

/** Used in `installColoredConsole`. */
function decorate(color: string, level: string): (text: string) => string {
  if (process.stderr.isTTY) return (text) => `${color}${text}${DEFAULT_COLOR}`;
  if (process.env.JOURNAL_STREAM !== undefined) return (text) => prefixLines(text, level);

  // Redirected to a file or a pipe: escape codes and `<3>` would both be noise.
  return (text) => text;
}

/**
 * Used in `index.ts`, before anything else can log.
 * Patches the global methods instead of every call site so that warnings and
 * errors raised inside dependencies are coloured too.
 */
export function installColoredConsole(): void {
  const asError = decorate(RED, LEVEL_ERR);
  const asWarning = decorate(YELLOW, LEVEL_WARNING);
  const writeError = console.error.bind(console);
  const writeWarning = console.warn.bind(console);

  console.error = (...args: unknown[]): void => {
    writeError(asError(formatWithOptions({ colors: false }, ...args)));
  };

  console.warn = (...args: unknown[]): void => {
    writeWarning(asWarning(formatWithOptions({ colors: false }, ...args)));
  };
}
