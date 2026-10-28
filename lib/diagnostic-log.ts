/** Recent warnings and errors kept in memory for the Telegram `/logs` command. */
const MAX_ENTRIES = 30;
const MAX_ENTRY_LENGTH = 600;

const entries: string[] = [];

/** Used by `colored-console.ts` before it prints a warning or error. */
export function rememberDiagnostic(
  level: 'WARN' | 'ERROR',
  message: string,
): void {
  const shortened =
    message.length > MAX_ENTRY_LENGTH
      ? `${message.slice(0, MAX_ENTRY_LENGTH)}…`
      : message;
  entries.push(`${new Date().toISOString()} ${level}: ${shortened}`);
  if (entries.length > MAX_ENTRIES) entries.shift();
}

/** Used by `/logs` to return a short, recent snapshot without journal access. */
export function getRecentDiagnosticLogs(limit = 4): string[] {
  return entries.slice(-limit);
}
