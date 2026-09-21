import { readFile } from 'node:fs/promises';
import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { AudioControl, PlayAudioOptions } from './type-audio-control.ts';
import {
  startAudioProcess,
  stopAudioProcess,
  runAudioCommand,
} from './run-audio-command.ts';
import {
  isMissingFilter,
  playbackFilterArgs,
} from './audio-normalize.ts';
import {
  isMissingLibopus,
  libopusEncoderArgs,
  nativeOpusEncoderArgs,
} from './wav-to-ogg-opus.ts';

const execFileAsync = promisify(execFile);

/** Used in `listAlsaHwCards`. Capture and playback devices on Linux. */
const PROC_PCM = '/proc/asound/pcm';

/** Used in `parseProcAsoundPcm`, `preferUsbCaptureCard` and `preferPlaybackCard`. */
type AlsaHwCard = {
  card: number;
  device: number;
  id: string;
  name: string;
};

/**
 * Used in `listAlsaHwCards`.
 * Parses `/proc/asound/pcm` lines like `01-00: USB Audio : USB Audio : playback 1 : capture 1`.
 */
function parseProcAsoundPcm(
  listing: string,
  role: 'capture' | 'playback',
): AlsaHwCard[] {
  const cards: AlsaHwCard[] = [];
  const pattern = /^(\d+)-(\d+):\s+(.+?)\s+:\s+(.+?)\s+:\s+(.+)$/gm;
  let match = pattern.exec(listing);
  while (match !== null) {
    const flags = match[5].toLowerCase();
    if (flags.includes(role)) cards.push({
        card: Number(match[1]),
        device: Number(match[2]),
        id: match[3],
        name: match[4],
      });

    match = pattern.exec(listing);
  }

  return cards;
}

/**
 * Used in `reportAlsaCaptureDevice`, `pickCaptureDevice` and `pickPlaybackDevice`.
 */
async function listAlsaHwCards(
  role: 'capture' | 'playback',
): Promise<AlsaHwCard[]> {
  const listing = await readFile(PROC_PCM, 'utf8');
  return parseProcAsoundPcm(listing, role);
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

  const hw = preferUsbCaptureCard(await listAlsaHwCards('capture'));
  if (hw === undefined) return undefined;
  return alsaPlughw(hw);
}

/** Used in `createRaspberryAudioControl` when playing an inbound voice note. */
async function pickPlaybackDevice(): Promise<string | undefined> {
  const env = (
    process.env.ALSA_PLAYBACK_DEVICE ?? process.env.ALSA_DEVICE
  )?.trim();
  if (env !== undefined && env !== '') return env;

  const hw = preferPlaybackCard(await listAlsaHwCards('playback'));
  if (hw === undefined) return undefined;
  return alsaPlughw(hw);
}

/**
 * Used in `chooseCaptureRate`.
 * Opus only ever encodes at 48 kHz, so recording at anything else guarantees a
 * resampling step later. Matching it here is what makes the chain conversion-free.
 */
const OPUS_RATE = 48000;

/**
 * Used in `ffmpegRecordArgs` and `primeAlsaCapture`.
 * Skip ffmpeg's default 5 s probe: that is what ate the first words on ALSA.
 */
const ALSA_LOW_LATENCY_INPUT = [
  '-fflags',
  'nobuffer',
  '-flags',
  'low_delay',
  '-probesize',
  '32',
  '-analyzeduration',
  '0',
];

/** Used in `pickCaptureRate`, keyed by ALSA device. */
const rateByDevice = new Map<string, number>();

/**
 * Used in `resolveCaptureDevice` and `startRecording`.
 * Filled by `primeAlsaCapture` so the first press does not wait on `/proc`.
 */
let cachedCaptureDevice: string | undefined;

/** Used in `primeAlsaCapture` and `createRaspberryAudioControl`. */
async function resolveCaptureDevice(): Promise<string> {
  if (cachedCaptureDevice !== undefined) return cachedCaptureDevice;
  cachedCaptureDevice = (await pickCaptureDevice()) ?? 'default';
  return cachedCaptureDevice;
}

/**
 * Used in `probeCaptureRate`.
 * `plughw:1,0` / `hw:1,0` → card 1, so we can read that card's USB stream info.
 */
function alsaCardNumber(device: string): number | undefined {
  const match = /^(?:plug)?hw:(\d+)/i.exec(device);
  if (match === null) return undefined;
  return Number(match[1]);
}

/**
 * Used in `chooseCaptureRate`.
 * USB `/proc/asound/cardN/stream0` uses `Rates: 8000, 48000`; collect every number
 * on a RATE line in the Capture section when present.
 */
function parseHwRates(dump: string): number[] {
  const rates: number[] = [];
  for (const line of dump.split('\n')) {
    if (!/RATE/i.test(line)) continue;
    for (const match of line.matchAll(/\d+/g)) rates.push(Number(match[0]));
  }

  return rates;
}

/** Used in `probeCaptureRate`. */
function parseUsbCaptureRates(dump: string): number[] {
  const capture = dump.split(/^Capture:\s*$/m)[1];
  if (capture === undefined) return parseHwRates(dump);
  return parseHwRates(capture);
}

/** Used in `pickCaptureRate`. */
function chooseCaptureRate(rates: number[]): number | undefined {
  if (rates.length === 0) return undefined;

  // Inside the supported span we prefer Opus' own rate even if the card lists
  // discrete values: at worst ALSA converts, which it would have to do anyway.
  if (OPUS_RATE >= Math.min(...rates) && OPUS_RATE <= Math.max(...rates)) return OPUS_RATE;

  // Otherwise record at the card's best and let ffmpeg do the single conversion,
  // since its resampler is far better than the one in ALSA's plug layer.
  return Math.max(...rates);
}

/**
 * Used in `createRaspberryAudioControl` and `reportAlsaCaptureDevice`.
 * `ALSA_RATE` wins; otherwise ask the card and fall back to Opus' rate.
 */
export async function pickCaptureRate(device: string): Promise<number> {
  const env = Number(process.env.ALSA_RATE?.trim());
  if (Number.isInteger(env) && env > 0) return env;

  const cached = rateByDevice.get(device);
  if (cached !== undefined) return cached;

  const rate = (await probeCaptureRate(device)) ?? OPUS_RATE;
  rateByDevice.set(device, rate);
  return rate;
}

/** Used in `pickCaptureRate`. */
async function probeCaptureRate(device: string): Promise<number | undefined> {
  const card = alsaCardNumber(device);
  if (card === undefined) return undefined;

  try {
    const dump = await readFile(
      `/proc/asound/card${String(card)}/stream0`,
      'utf8',
    );
    return chooseCaptureRate(parseUsbCaptureRates(dump));
  } catch {
    return undefined;
  }
}

/**
 * Used in `index.ts` after `reportAlsaCaptureDevice`.
 * Opens the USB mic once so the first button press does not pay ALSA's cold start,
 * and caches device + rate for `startRecording`.
 */
export async function primeAlsaCapture(): Promise<void> {
  const device = await resolveCaptureDevice();
  const rate = await pickCaptureRate(device);
  try {
    await runAudioCommand('ffmpeg', [
      '-nostdin',
      '-y',
      '-loglevel',
      'error',
      ...ALSA_LOW_LATENCY_INPUT,
      '-f',
      'alsa',
      '-ac',
      '1',
      '-ar',
      String(rate),
      '-i',
      device,
      '-t',
      '0.05',
      '-f',
      'null',
      '-',
    ]);
  } catch (error: unknown) {
    console.warn(
      'No se pudo preparar el micrófono al arrancar; la primera grabación puede tardar un poco más.',
      error,
    );
  }
}

/**
 * Used in `reportAlsaCaptureDevice` and `reportAlsaPlaybackDevice`.
 * Cards often ship muted or near 0 %, which is the usual reason audio is audible
 * but far too quiet no matter how close you speak or how loud the speaker is.
 */
async function readMixerVolumePercent(
  card: number,
  direction: 'Capture' | 'Playback',
): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'amixer',
      ['-c', String(card), 'scontents'],
      { encoding: 'utf8', timeout: 5000 },
    );
    const match = new RegExp(`${direction} \\d+ \\[(\\d+)%\\]`).exec(stdout);
    return match === null ? undefined : Number(match[1]);
  } catch {
    return undefined;
  }
}

/** Used in `reportAlsaCaptureDevice` and `reportAlsaPlaybackDevice`. */
function volumeLine(
  label: string,
  volume: number,
  card: number,
  hint: string,
): string {
  const base = `  ${label}: ${String(volume)} %`;
  if (volume >= 80) return base;

  return (
    `${base} — baja. Súbela con \`alsamixer -c ${String(card)}\` (${hint}) ` +
    'y guárdala con `sudo alsactl store`.'
  );
}

/**
 * Used in `reportAlsaCaptureDevice`.
 * Recording at anything other than 48 kHz is the quiet, invisible way to lose
 * quality: ALSA converts on the way in and ffmpeg converts it back for Opus.
 */
async function captureRateLine(device: string): Promise<string> {
  const rate = await pickCaptureRate(device);
  const base = `  Frecuencia: ${String(rate)} Hz`;

  if (process.env.ALSA_RATE?.trim() !== undefined && process.env.ALSA_RATE.trim() !== '') return `${base} (forzada con ALSA_RATE en .env)`;

  if (rate === OPUS_RATE) return `${base} — la misma que usa Opus, sin remuestreo`;

  return (
    `${base} — el micrófono no llega a ${String(OPUS_RATE)} Hz, así que ffmpeg ` +
    'convierte al codificar.'
  );
}

/**
 * Used in `index.ts` on `npm start`, printed as part of the startup banner.
 * `/proc/asound/pcm` capture lines only; HDMI and the Pi jack never appear here.
 * ALSA `default` is often `pcm_asym` (playback, no capture slave) — we pick a USB `plughw`.
 */
export async function reportAlsaCaptureDevice(): Promise<void> {
  let cards: AlsaHwCard[];
  try {
    cards = await listAlsaHwCards('capture');
  } catch (error: unknown) {
    console.warn('Micrófono: no se pudo listar la captura (`/proc/asound/pcm`).', error);
    return;
  }

  if (cards.length === 0) {
    console.warn(
      'Micrófono: ninguno. `/proc/asound/pcm` no lista entradas y el jack de la Pi no tiene. ' +
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
      '  No parece un micrófono USB. Si enchufaste uno, comprueba que aparezca en `/proc/asound/pcm`.',
    );

  const others = cards.filter((card) => card !== hw);
  if (others.length > 0) console.log(
      `  Otras entradas: ${others.map(describeAlsaCard).join(', ')}. ` +
        'Para forzar una: ALSA_DEVICE=plughw:N,0 en .env',
    );

  console.log(await captureRateLine(alsaPlughw(hw)));

  const volume = await readMixerVolumePercent(hw.card, 'Capture');
  if (volume === undefined) return;

  console.log(volumeLine('Ganancia de captura', volume, hw.card, 'F4 = Capture'));
}

/**
 * Used in `index.ts` on `npm start`, right after `reportAlsaCaptureDevice`.
 * Same idea for the speaker side: a card at 30 % sounds broken, not quiet.
 */
export async function reportAlsaPlaybackDevice(): Promise<void> {
  let cards: AlsaHwCard[];
  try {
    cards = await listAlsaHwCards('playback');
  } catch {
    return;
  }

  if (cards.length === 0) {
    console.warn('Parlante: ninguno (`/proc/asound/pcm` no lista salidas).');
    return;
  }

  const env = (
    process.env.ALSA_PLAYBACK_DEVICE ?? process.env.ALSA_DEVICE
  )?.trim();
  if (env !== undefined && env !== '') {
    console.log(`Parlante: ${env} (forzado en .env)`);
    return;
  }

  const hw = preferPlaybackCard(cards);
  if (hw === undefined) return;

  console.log(`Parlante: ${describeAlsaCard(hw)}`);

  const others = cards.filter((card) => card !== hw);
  if (others.length > 0) console.log(
      `  Otras salidas: ${others.map(describeAlsaCard).join(', ')}. ` +
        'Para forzar una: ALSA_PLAYBACK_DEVICE=plughw:N,0 en .env',
    );

  const volume = await readMixerVolumePercent(hw.card, 'Playback');
  if (volume === undefined) return;

  console.log(volumeLine('Volumen de salida', volume, hw.card, 'F3 = Playback'));
}

/**
 * Used in `startFfmpegRecording`.
 * ALSA input at `rate`, then Opus at 48 kHz so any resample happens inside ffmpeg.
 * No live `speechnorm`: it ramps gain and swallows the start of the sentence.
 */
function ffmpegRecordArgs(
  outputPath: string,
  device: string,
  rate: number,
  encoderArgs: string[],
): string[] {
  return [
    '-y',
    '-loglevel',
    'error',
    ...ALSA_LOW_LATENCY_INPUT,
    '-f',
    'alsa',
    '-thread_queue_size',
    '1024',
    '-ac',
    '1',
    '-ar',
    String(rate),
    '-i',
    device,
    ...encoderArgs,
    '-ac',
    '1',
    '-ar',
    String(OPUS_RATE),
    '-flush_packets',
    '1',
    outputPath,
  ];
}

/** Used in `playAlsa`. */
function ffmpegPlayArgs(
  filePath: string,
  device: string,
  filterArgs: string[],
): string[] {
  return [
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    filePath,
    ...filterArgs,
    '-f',
    'alsa',
    device,
  ];
}

/**
 * Used in `startFfmpegRecording`.
 * ffmpeg rejects a bad encoder immediately; after this window it is capturing.
 */
function waitUntilRecordingStarted(
  child: ChildProcess,
  getStderr: () => string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 80);

    const onSpawnError = (error: Error): void => {
      cleanup();
      reject(
        new Error(`Could not start ffmpeg. Is ffmpeg installed?`, {
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

      const details = getStderr().trim();
      reject(
        new Error(
          details.length > 0
            ? `ffmpeg failed to start recording: ${details}`
            : `ffmpeg failed to start recording (code=${String(code)}). Enchufa un micrófono USB o pon ALSA_DEVICE en .env`,
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
}

/**
 * Used in `createRaspberryAudioControl`.
 * Retries with native `opus` if this ffmpeg build lacks `libopus`.
 */
async function startFfmpegRecording(
  outputPath: string,
  device: string,
  rate: number,
  encoderArgs: string[],
): Promise<{
  child: ChildProcess;
  stderr: () => string;
  encoderArgs: string[];
}> {
  let nextEncoder = encoderArgs;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let recordingStderr = '';
    const child = startAudioProcess(
      'ffmpeg',
      ffmpegRecordArgs(outputPath, device, rate, nextEncoder),
      { stdin: true },
    );

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      recordingStderr += chunk;
    });

    try {
      await waitUntilRecordingStarted(child, () => recordingStderr);
      return {
        child,
        stderr: () => recordingStderr,
        encoderArgs: nextEncoder,
      };
    } catch (error: unknown) {
      if (nextEncoder.includes('libopus') && isMissingLibopus(error)) {
        nextEncoder = nativeOpusEncoderArgs();
        continue;
      }

      throw error;
    }
  }

  throw new Error('Could not start ffmpeg recording');
}

/**
 * Used in `createRaspberryAudioControl`.
 * On a build without `loudnorm` it retries keeping any fixed gain, which is the
 * part a quiet asset like the chime actually depends on to be heard.
 */
async function playAlsa(
  filePath: string,
  device: string,
  options?: PlayAudioOptions,
): Promise<void> {
  try {
    await runAudioCommand(
      'ffmpeg',
      ffmpegPlayArgs(filePath, device, playbackFilterArgs(options)),
    );
  } catch (error: unknown) {
    if (options?.normalizePlayback !== true || !isMissingFilter(error)) throw error;

    console.warn(
      'Este ffmpeg no tiene `loudnorm`: se reproduce sin normalizar el volumen.',
    );
    await runAudioCommand(
      'ffmpeg',
      ffmpegPlayArgs(
        filePath,
        device,
        playbackFilterArgs({ ...options, normalizePlayback: false }),
      ),
    );
  }
}

/**
 * Used in `create-audio-control.ts` for `npm start` on the Raspberry Pi.
 */
export function createRaspberryAudioControl(): AudioControl {
  let recording: ChildProcess | undefined;
  let recordEncoderArgs: string[] | undefined;
  let loggedPlayback = false;

  return {
    name: 'raspberry (ffmpeg / alsa)',

    async startRecording(outputPath: string): Promise<void> {
      if (recording) throw new Error('Recording already in progress');

      const device = await resolveCaptureDevice();
      const rate = rateByDevice.get(device) ?? (await pickCaptureRate(device));
      const started = await startFfmpegRecording(
        outputPath,
        device,
        rate,
        recordEncoderArgs ?? libopusEncoderArgs(),
      );

      recordEncoderArgs = started.encoderArgs;
      const child = started.child;
      recording = child;

      child.once('exit', (code, signal) => {
        if (recording === child) recording = undefined;

        if (code !== 0 && code !== null && signal === null) {
          const details = started.stderr().trim();
          console.error(
            details.length > 0
              ? `ffmpeg exited early: ${details}`
              : `ffmpeg exited early (code=${String(code)})`,
          );
        }
      });

      child.once('error', (error) => {
        if (recording === child) recording = undefined;
        console.error('ffmpeg failed to start. Is ffmpeg installed?', error);
      });
    },

    async stopRecording(): Promise<void> {
      const child = recording;
      recording = undefined;

      if (!child) return;

      await stopAudioProcess(child);
    },

    async play(filePath: string, options?: PlayAudioOptions): Promise<void> {
      const device = (await pickPlaybackDevice()) ?? 'default';
      if (device !== 'default' && !loggedPlayback) {
        loggedPlayback = true;
        console.log(`Reproducción ALSA: ${device}`);
      }

      await playAlsa(filePath, device, options);
    },
  };
}
