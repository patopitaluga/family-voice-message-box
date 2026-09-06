import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { AudioControl } from './type-audio-control.ts';
import {
  runAudioCommand,
  startAudioProcess,
  stopAudioProcess,
} from './run-audio-command.ts';

const execFileAsync = promisify(execFile);

/** Used in `parseAlsaHwCards`, `preferUsbCaptureCard` and `preferPlaybackCard`. */
type AlsaHwCard = {
  card: number;
  device: number;
  id: string;
  name: string;
};

/**
 * Used in `listAlsaHwCards`.
 * Parses `arecord -l` / `aplay -l` lines like `card 1: Headset [USB Headphones], device 0:`.
 */
function parseAlsaHwCards(listing: string): AlsaHwCard[] {
  const cards: AlsaHwCard[] = [];
  const pattern =
    /^card\s+(\d+):\s+(\S+)\s+\[([^\]]*)\],\s+device\s+(\d+):/gm;
  let match = pattern.exec(listing);
  while (match !== null) {
    cards.push({
      card: Number(match[1]),
      device: Number(match[4]),
      id: match[2],
      name: match[3],
    });
    match = pattern.exec(listing);
  }

  return cards;
}

/**
 * Used in `reportAlsaCaptureDevice`, `pickCaptureDevice` and `pickPlaybackDevice`.
 */
async function listAlsaHwCards(tool: 'arecord' | 'aplay'): Promise<AlsaHwCard[]> {
  try {
    const result = await execFileAsync(tool, ['-l'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return parseAlsaHwCards(result.stdout);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'stdout' in error) return parseAlsaHwCards(String((error as { stdout?: string }).stdout ?? ''));

    throw error;
  }
}

/** Used in `preferUsbCaptureCard` and `reportAlsaCaptureDevice`. */
function isUsbCard(card: AlsaHwCard): boolean {
  return /usb|headset|microphone|\bmic\b|webcam|pnpsound/i.test(
    `${card.id} ${card.name}`,
  );
}

/**
 * Used in `preferUsbCaptureCard`.
 * Onboard Pi audio (`bcm2835` jack, `vc4-hdmi`) is playback-only, so it must never
 * win the capture pick even when ALSA numbers it as card 0.
 */
function isOnboardPiCard(card: AlsaHwCard): boolean {
  return /bcm2835|vc4|hdmi/i.test(`${card.id} ${card.name}`);
}

/** Used in `pickCaptureDevice` and `reportAlsaCaptureDevice`. */
function preferUsbCaptureCard(cards: AlsaHwCard[]): AlsaHwCard | undefined {
  return (
    cards.find((card) => isUsbCard(card) && !isOnboardPiCard(card)) ??
    cards.find((card) => !isOnboardPiCard(card)) ??
    cards[0]
  );
}

/**
 * Used in `pickPlaybackDevice`.
 * Unlike capture, the box can legitimately play through the Pi 3.5 mm jack.
 */
function preferPlaybackCard(cards: AlsaHwCard[]): AlsaHwCard | undefined {
  const known = cards.find((card) =>
    /usb|headset|headphone|microphone|\bmic\b|webcam|pnpsound/i.test(
      `${card.id} ${card.name}`,
    ),
  );
  return known ?? cards[0];
}

/** Used in `reportAlsaCaptureDevice`, `pickCaptureDevice` and `pickPlaybackDevice`. */
function alsaPlughw(card: AlsaHwCard): string {
  return `plughw:${String(card.card)},${String(card.device)}`;
}

/** Used in `reportAlsaCaptureDevice`. */
function describeAlsaCard(card: AlsaHwCard): string {
  return `${card.name} (${alsaPlughw(card)})`;
}

/**
 * Used in `createRaspberryAudioControl` when a recording starts.
 * `ALSA_DEVICE` wins; otherwise the USB mic, never the onboard/HDMI card.
 */
async function pickCaptureDevice(): Promise<string | undefined> {
  const env = process.env.ALSA_DEVICE?.trim();
  if (env !== undefined && env !== '') return env;

  const hw = preferUsbCaptureCard(await listAlsaHwCards('arecord'));
  if (hw === undefined) return undefined;
  return alsaPlughw(hw);
}

/** Used in `createRaspberryAudioControl` when playing an inbound voice note. */
async function pickPlaybackDevice(): Promise<string | undefined> {
  const env = (
    process.env.ALSA_PLAYBACK_DEVICE ?? process.env.ALSA_DEVICE
  )?.trim();
  if (env !== undefined && env !== '') return env;

  const hw = preferPlaybackCard(await listAlsaHwCards('aplay'));
  if (hw === undefined) return undefined;
  return alsaPlughw(hw);
}

/**
 * Used in `reportAlsaCaptureDevice`.
 * USB mics often ship muted or near 0 %, which is the usual reason a recording is
 * audible but far too quiet no matter how close you speak.
 */
async function readCaptureVolumePercent(card: number): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'amixer',
      ['-c', String(card), 'scontents'],
      { encoding: 'utf8', timeout: 5000 },
    );
    const match = /Capture \d+ \[(\d+)%\]/.exec(stdout);
    return match === null ? undefined : Number(match[1]);
  } catch {
    return undefined;
  }
}

/**
 * Used in `index.ts` on `npm start`, printed as part of the startup banner.
 * `arecord -l` only lists capture cards, so HDMI and the Pi jack never appear here.
 * ALSA `default` is often `pcm_asym` (playback, no capture slave) — we pick a USB `plughw`.
 */
export async function reportAlsaCaptureDevice(): Promise<void> {
  let cards: AlsaHwCard[];
  try {
    cards = await listAlsaHwCards('arecord');
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.warn(
        'Micrófono: no se encontró `arecord`. Instala alsa-utils: sudo apt install -y alsa-utils',
      );
      return;
    }

    console.warn('Micrófono: no se pudo listar la captura (`arecord -l`).', error);
    return;
  }

  if (cards.length === 0) {
    console.warn(
      'Micrófono: ninguno. `arecord -l` está vacío y el jack de la Pi no tiene entrada. ' +
        'Enchufa un micrófono USB y vuelve a ejecutar npm start.',
    );
    return;
  }

  const env = process.env.ALSA_DEVICE?.trim();
  if (env !== undefined && env !== '') {
    console.log(`Micrófono: ${env} (forzado con ALSA_DEVICE en .env)`);
    return;
  }

  const hw = preferUsbCaptureCard(cards);
  if (hw === undefined) return;

  console.log(`Micrófono: ${describeAlsaCard(hw)}`);

  if (!isUsbCard(hw)) console.warn(
      '  No parece un micrófono USB. Si enchufaste uno, comprueba que la Pi lo vea con `arecord -l`.',
    );

  const others = cards.filter((card) => card !== hw);
  if (others.length > 0) console.log(
      `  Otras entradas: ${others.map(describeAlsaCard).join(', ')}. ` +
        'Para forzar una: ALSA_DEVICE=plughw:N,0 en .env',
    );

  const volume = await readCaptureVolumePercent(hw.card);
  if (volume === undefined) return;

  console.log(
    volume < 80
      ? `  Ganancia de captura: ${String(volume)} % — baja. Súbela con \`alsamixer -c ${String(hw.card)}\` (F4 = Capture) y guárdala con \`sudo alsactl store\`.`
      : `  Ganancia de captura: ${String(volume)} %`,
  );
}

/**
 * Used in `createRaspberryAudioControl`.
 */
function arecordArgs(outputPath: string, device: string | undefined): string[] {
  const args = ['-f', 'S16_LE', '-r', '44100', '-c', '1'];
  if (device !== undefined && device !== '') args.push('-D', device);

  args.push('-t', 'wav', outputPath);
  return args;
}

/**
 * Used in `create-audio-control.ts` for `npm start` on the Raspberry Pi.
 */
export function createRaspberryAudioControl(): AudioControl {
  let recording: ChildProcess | undefined;
  let recordingStderr = '';
  let loggedPlayback = false;

  return {
    name: 'raspberry (arecord / aplay)',

    async startRecording(outputPath: string): Promise<void> {
      if (recording) throw new Error('Recording already in progress');

      const device = await pickCaptureDevice();
      recordingStderr = '';
      const child = startAudioProcess('arecord', arecordArgs(outputPath, device));

      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        recordingStderr += chunk;
      });

      recording = child;

      child.once('exit', (code, signal) => {
        if (recording === child) recording = undefined;

        if (code !== 0 && code !== null && signal === null) {
          const details = recordingStderr.trim();
          console.error(
            details.length > 0
              ? `arecord exited early: ${details}`
              : `arecord exited early (code=${String(code)})`,
          );
        }
      });

      child.once('error', (error) => {
        if (recording === child) recording = undefined;
        console.error('arecord failed to start. Is alsa-utils installed?', error);
      });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, 400);

        const onSpawnError = (error: Error): void => {
          cleanup();
          reject(
            new Error(`Could not start arecord. Is alsa-utils installed?`, {
              cause: error,
            }),
          );
        };

        const onExit = (
          code: number | null,
          signal: NodeJS.Signals | null,
        ): void => {
          cleanup();
          if (signal !== null) {
            resolve();
            return;
          }

          const details = recordingStderr.trim();
          reject(
            new Error(
              details.length > 0
                ? `arecord failed to start recording: ${details}`
                : `arecord failed to start recording (code=${String(code)}). Try: arecord -l`,
            ),
          );
        };

        const cleanup = (): void => {
          clearTimeout(timer);
          child.off('exit', onExit);
          child.off('error', onSpawnError);
        };

        child.once('exit', onExit);
        child.once('error', onSpawnError);
      });
    },

    async stopRecording(): Promise<void> {
      const child = recording;
      recording = undefined;

      if (!child) return;

      await stopAudioProcess(child);
    },

    async play(filePath: string): Promise<void> {
      const device = await pickPlaybackDevice();
      if (device !== undefined && !loggedPlayback) {
        loggedPlayback = true;
        console.log(`Reproducción ALSA: ${device}`);
      }

      const args = device === undefined ? [filePath] : ['-D', device, filePath];
      await runAudioCommand('aplay', args);
    },
  };
}
