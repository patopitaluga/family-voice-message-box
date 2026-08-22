import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { AudioControl } from './type-audio-control.ts';
import {
  runAudioCommand,
  startAudioProcess,
  stopAudioProcess,
} from './run-audio-command.ts';

const execFileAsync = promisify(execFile);

/** Used in `parseAlsaHwCards` and `preferUsbAlsaCard`. */
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
 * Used in `warnIfNoAlsaCaptureDevice` and `pickAlsaPlughw`.
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

/**
 * Used in `pickAlsaPlughw` and `warnIfNoAlsaCaptureDevice`.
 * Pi onboard/HDMI cards are usually playback-only; USB headsets show up as capture.
 */
function preferUsbAlsaCard(cards: AlsaHwCard[]): AlsaHwCard | undefined {
  const usb = cards.find((card) =>
    /usb|headset|headphone|microphone|\bmic\b|webcam|pnpsound/i.test(
      `${card.id} ${card.name}`,
    ),
  );
  return usb ?? cards[0];
}

/** Used in `warnIfNoAlsaCaptureDevice` and `createRaspberryAudioControl`. */
function alsaPlughw(card: AlsaHwCard): string {
  return `plughw:${String(card.card)},${String(card.device)}`;
}

/**
 * Used in `createRaspberryAudioControl`.
 * `ALSA_DEVICE` / `ALSA_PLAYBACK_DEVICE` win; otherwise first USB-looking card.
 */
async function pickAlsaPlughw(
  tool: 'arecord' | 'aplay',
  envOverride: string | undefined,
): Promise<string | undefined> {
  const env = envOverride?.trim();
  if (env !== undefined && env !== '') return env;

  const hw = preferUsbAlsaCard(await listAlsaHwCards(tool));
  if (hw === undefined) return undefined;
  return alsaPlughw(hw);
}

/**
 * Used in `index.ts` on `npm start`.
 * `arecord -l` lists capture cards; the Pi headphone jack is output-only.
 * ALSA `default` is often `pcm_asym` (playback, no capture slave) — we pick USB `plughw`.
 */
export async function warnIfNoAlsaCaptureDevice(): Promise<void> {
  let cards: AlsaHwCard[];
  try {
    cards = await listAlsaHwCards('arecord');
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.warn(
        'No se encontró `arecord`. Instala alsa-utils: sudo apt install -y alsa-utils',
      );
      return;
    }

    console.warn('No se pudo listar dispositivos de captura (`arecord -l`).', error);
    return;
  }

  if (cards.length === 0) {
    console.warn(
      'No hay micrófono de captura (`arecord -l` está vacío). ' +
        'El jack de auriculares de la Raspberry Pi no tiene entrada de micrófono. ' +
        'Enchufa un micrófono USB (u otro dispositivo de captura) y vuelve a ejecutar npm start.',
    );
    return;
  }

  const env = process.env.ALSA_DEVICE?.trim();
  if (env !== undefined && env !== '') {
    console.log(`Captura ALSA: ${env} (ALSA_DEVICE)`);
    return;
  }

  const hw = preferUsbAlsaCard(cards);
  if (hw === undefined) return;

  console.log(
    `Captura ALSA: ${alsaPlughw(hw)} (${hw.name}). ` +
      'El PCM default de la Pi no graba (pcm_asym). Para forzar otro: ALSA_DEVICE=plughw:N,0',
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

      const device = await pickAlsaPlughw('arecord', process.env.ALSA_DEVICE);
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
      const device = await pickAlsaPlughw(
        'aplay',
        process.env.ALSA_PLAYBACK_DEVICE ?? process.env.ALSA_DEVICE,
      );
      if (device !== undefined && !loggedPlayback) {
        loggedPlayback = true;
        console.log(`Reproducción ALSA: ${device}`);
      }

      const args = device === undefined ? [filePath] : ['-D', device, filePath];
      await runAudioCommand('aplay', args);
    },
  };
}
