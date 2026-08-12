import { spawn, type ChildProcess } from 'node:child_process';

type StartAudioProcessOptions = {
  /** When true, stdin is a pipe so callers can send ffmpeg's `q` to stop cleanly. */
  stdin?: boolean;
};

/**
 * Used in `raspberry-audio.ts` and `mac-audio.ts`.
 */
export function startAudioProcess(
  command: string,
  args: string[],
  options?: StartAudioProcessOptions,
): ChildProcess {
  return spawn(command, args, {
    stdio: [options?.stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'],
  });
}

/**
 * Used in `raspberry-audio.ts` and `mac-audio.ts` when ending a recording.
 * Sends `q` when stdin is available (ffmpeg), otherwise SIGINT (`arecord`).
 */
export async function stopAudioProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const forceKill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, 3000);

    child.once('error', (error) => {
      clearTimeout(forceKill);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(forceKill);
      resolve();
    });

    if (child.stdin && !child.stdin.destroyed) {
      child.stdin.write('q');
      child.stdin.end();

      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGINT');
        }
      }, 800);
      return;
    }

    child.kill('SIGINT');
  });
}

/**
 * Used in `raspberry-audio.ts` and `mac-audio.ts` for one-shot playback.
 */
export async function runAudioCommand(
  command: string,
  args: string[],
): Promise<void> {
  const child = startAudioProcess(command, args);

  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} failed (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    });
  });
}
