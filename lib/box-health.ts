import { readFile, statfs } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Platform } from './create-audio-control.ts';

const execFileAsync = promisify(execFile);

/** Used by the Telegram `/health` command. */
export async function getBoxHealth(platform: Platform): Promise<string> {
  const checks: string[] = [];
  const warnings: string[] = [];

  try {
    const filesystem = await statfs(process.cwd());
    const totalBytes = filesystem.blocks * filesystem.bsize;
    const freeBytes = filesystem.bavail * filesystem.bsize;
    const freePercent = totalBytes === 0 ? 0 : (freeBytes / totalBytes) * 100;
    checks.push(`Disco: ${freePercent.toFixed(0)}% libre (${formatBytes(freeBytes)})`);
    if (freePercent < 10) warnings.push('Queda menos del 10% de espacio libre.');
  } catch (error: unknown) {
    checks.push(`Disco: no se pudo comprobar (${errorMessage(error)})`);
    warnings.push('No se pudo comprobar el espacio en disco.');
  }

  const memory = process.memoryUsage();
  checks.push(`Memoria del proceso: ${formatBytes(memory.rss)} RSS`);

  if (platform === 'raspberry') {
    try {
      const pcm = await readFile('/proc/asound/pcm', 'utf8');
      const capture = pcm
        .split('\n')
        .filter((line) => line.includes('capture'));
      const playback = pcm
        .split('\n')
        .filter((line) => line.includes('playback'));

      checks.push(`Micrófono: ${capture.length > 0 ? 'detectado' : 'NO detectado'}`);
      checks.push(`Salida de audio: ${playback.length > 0 ? 'detectada' : 'NO detectada'}`);
      if (capture.length === 0) warnings.push('ALSA no muestra ningún dispositivo de captura.');
      if (playback.length === 0) warnings.push('ALSA no muestra ningún dispositivo de reproducción.');
    } catch (error: unknown) {
      checks.push(`ALSA: no se pudo comprobar (${errorMessage(error)})`);
      warnings.push('No se pudo leer la lista de dispositivos ALSA.');
    }

    try {
      const { stdout } = await execFileAsync(
        'vcgencmd',
        ['get_throttled'],
        { encoding: 'utf8', timeout: 2000 },
      );
      const throttled = stdout.trim().split('=').at(-1) ?? 'desconocido';
      checks.push(`Alimentación/temperatura Pi: throttled=${throttled}`);
      if (throttled !== '0x0') warnings.push(
          'La Pi informa limitación por alimentación o temperatura (vcgencmd).',
        );
    } catch {
      checks.push('Alimentación/temperatura Pi: vcgencmd no disponible');
    }
  } else checks.push('Audio: macOS; el dispositivo se comprueba al iniciar una grabación.');

  return [
    warnings.length === 0 ? 'Salud: sin problemas detectados' : 'Salud: revisar',
    ...checks,
    ...(warnings.length === 0 ? [] : ['', ...warnings.map((warning) => `⚠️ ${warning}`)]),
  ].join('\n');
}

/** Used in `/health` when a local system check fails. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Used in `/health` to keep the Telegram response compact. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
