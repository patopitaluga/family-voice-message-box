import { stat, unlink } from 'node:fs/promises';
import {
  createAudioControl,
  detectPlatform,
  parseRunMode,
} from './lib/create-audio-control.ts';
import { convertOggOpusToWav } from './lib/ogg-opus-to-wav.ts';
import {
  convertWavToOggOpus,
  normalizeRecordedOpus,
} from './lib/wav-to-ogg-opus.ts';
import { listenToMacSpacebar } from './lib/mac-spacebar.ts';
import { listenToRaspberryButtons } from './lib/raspberry-button.ts';
import type { StopListening } from './lib/hold-to-talk.ts';
import { combineLeds } from './lib/combine-leds.ts';
import { createConsoleLedPair } from './lib/create-console-led-pair.ts';
import { createRaspberryGpioLed } from './lib/raspberry-gpio-led.ts';
import { blinkLedsOnce } from './lib/blink-leds-once.ts';
import { playChime } from './lib/chime.ts';
import { installColoredConsole } from './lib/colored-console.ts';
import {
  primeAlsaCapture,
  reportAlsaCaptureDevice,
  reportAlsaPlaybackDevice,
} from './lib/raspberry-audio.ts';
import { listenToLinuxKeyboard } from './lib/linux-keyboard.ts';
import { listenToTerminalKeys } from './lib/terminal-keys.ts';
import { listenToFamilyGroupVoices } from './lib/listen-family-group-voices.ts';
import { ensureTempDir, tempPath } from './lib/temp-dir.ts';
import {
  tgGetMe,
  tgRequireFamilyGroup,
  tgSendMessage,
  tgSendVoice,
} from './send-audio-tg.ts';

installColoredConsole();

/** Sent by `announceReady` once every listener is up, so the family knows the box is on. */
const READY_MESSAGE = 'Family Voice Box lista para comunicarse!';

/**
 * Shorter than this is a phantom press (GPIO noise, a stray key), not a message.
 * Those recordings are kept in `temp/` instead of sent, so they can be inspected.
 */
const MIN_RECORDING_MS = 2000;

const telegramToken = process.env.TELEGRAM_TOKEN?.trim();
const chatId = process.env.CHAT_ID?.trim();

if (!telegramToken) throw new Error('TELEGRAM_TOKEN is not set');
if (!chatId) throw new Error('CHAT_ID is not set');

const familyGroup = await tgRequireFamilyGroup(telegramToken, chatId);
const bot = await tgGetMe(telegramToken);

const mode = parseRunMode();
const platform = detectPlatform();

/* Disabled temporaily
if (mode === 'prod' && platform !== 'raspberry') {
  console.error(
    '`npm start` es la caja en funcionamiento y necesita una Raspberry. ' +
      'Fuera de la Pi usa `npm run start:dev`.',
  );
  process.exit(1);
} */

const audio = createAudioControl(platform);

await ensureTempDir();

const gpioChip = process.env.GPIO_CHIP ?? 'gpiochip0';
const recordLedLine = Number(process.env.GPIO_RECORD_LED ?? '27');
const playLedLine = Number(process.env.GPIO_PLAY_LED ?? '23');

const consoleLeds = createConsoleLedPair();
const recordLed =
  platform === 'raspberry'
    ? combineLeds(createRaspberryGpioLed(gpioChip, recordLedLine), consoleLeds.record)
    : consoleLeds.record;
const playLed =
  platform === 'raspberry'
    ? combineLeds(createRaspberryGpioLed(gpioChip, playLedLine), consoleLeds.play)
    : consoleLeds.play;

if (platform === 'raspberry') {
  console.log(
    `Probando LEDs 2 s: grabar (GPIO ${String(recordLedLine)}) y oír (GPIO ${String(playLedLine)}). ` +
      'Los dos tienen que encenderse; el que no, está mal cableado.',
  );
  await blinkLedsOnce([recordLed, playLed]);
}

let currentRecordingPath: string | undefined;
let recordingStartedAt: number | undefined;
let isRecording = false;

/** Local OGG paths from the family group, waiting to be played. */
const pendingInboundOggs: string[] = [];

/** Kept on disk after playing so the play button can repeat it as many times as wanted. */
let lastPlayedOgg: string | undefined;

let unheardAudio = false;
let playButtonHeld = false;

/**
 * Used in `setUnheardAudio` and the `onPlayHeld` handler.
 * Two independent reasons to be lit, so both have to be re-evaluated together:
 * otherwise draining the queue mid-press would switch the LED off under the finger.
 */
function refreshPlayLed(): void {
  playLed.set(unheardAudio || playButtonHeld);
}

/**
 * Used when a family voice arrives or after play drains the queue.
 * The chime only sounds on the off → on edge, and not while recording: playback
 * would bleed into the message the child is speaking.
 */
function setUnheardAudio(pending: boolean): void {
  const turnedOn = pending && !unheardAudio;
  unheardAudio = pending;
  refreshPlayLed();

  if (turnedOn && !isRecording) void playChime(audio);
}

/** Used in `onPlayLast` to forget a repeat whose file is no longer on disk. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

const handlers = {
  onRecordHeld(pressed: boolean) {
    recordLed.set(pressed);
  },

  async onPress() {
    if (isRecording) return;

    currentRecordingPath = tempPath(
      `out-${String(Date.now())}.${platform === 'raspberry' ? 'ogg' : 'wav'}`,
    );
    console.log('Grabando…');
    try {
      await audio.startRecording(currentRecordingPath);
    } catch (error: unknown) {
      currentRecordingPath = undefined;
      throw error;
    }
    recordingStartedAt = Date.now();
    isRecording = true;
  },

  async onRelease() {
    if (!isRecording) return;

    isRecording = false;
    await audio.stopRecording();

    const recordedPath = currentRecordingPath;
    const startedAt = recordingStartedAt;
    currentRecordingPath = undefined;
    recordingStartedAt = undefined;

    const durationMs =
      startedAt === undefined ? undefined : Date.now() - startedAt;

    let recordedExists = false;
    let sizeLabel = 'tamaño desconocido';
    if (recordedPath !== undefined) try {
        const { size } = await stat(recordedPath);
        recordedExists = true;
        if (size < 1024) sizeLabel = `${String(size)} B`;
         else if (size < 1024 * 1024) sizeLabel = `${(size / 1024).toFixed(1)} KB`;
         else sizeLabel = `${(size / (1024 * 1024)).toFixed(2)} MB`;

      } catch {
        sizeLabel = 'archivo no encontrado';
      }

    let durationLabel = 'duración desconocida';
    if (durationMs !== undefined) {
      const seconds = durationMs / 1000;
      if (seconds < 60) durationLabel = `${seconds.toFixed(1)} s / ${String(durationMs)} ms`;
       else {
        const minutes = Math.floor(seconds / 60);
        const remainder = seconds - minutes * 60;
        durationLabel = `${String(minutes)} m ${remainder.toFixed(1)} s`;
      }
    }

    console.log(
      `Grabación lista (${durationLabel}, ${sizeLabel})`,
    );

    if (recordedPath === undefined) return;
    if (!recordedExists) {
      console.error(
        'ffmpeg no escribió el audio. En la Pi: enchufa un micrófono USB (tiene que aparecer en `/proc/asound/pcm`). ' +
          'Grupo audio: sudo usermod -aG audio $USER. Opcional: ALSA_DEVICE=plughw:1,0 en .env',
      );
      return;
    }

    if (durationMs !== undefined && durationMs < MIN_RECORDING_MS) {
      console.warn(
        `No se envía: ${String(durationMs)} ms está por debajo del mínimo de ${String(MIN_RECORDING_MS)} ms. ` +
          `Suele ser una pulsación fantasma. El audio queda en ${recordedPath} para inspeccionarlo.`,
      );
      return;
    }

    const needsEncode = recordedPath.endsWith('.wav');
    let oggPath: string | undefined;
    try {
      if (needsEncode) {
        console.log('Convirtiendo a OGG/Opus…');
        oggPath = await convertWavToOggOpus(
          recordedPath,
          tempPath(`out-${String(Date.now())}.ogg`),
        );
        await unlink(recordedPath).catch(() => undefined);
      } else {
        oggPath = await normalizeRecordedOpus(
          recordedPath,
          tempPath(`out-${String(Date.now())}.ogg`),
        );
        if (oggPath !== recordedPath) await unlink(recordedPath).catch(() => undefined);
      }

      if (oggPath === undefined) return;

      console.log('Enviando a Telegram…');
      await tgSendVoice(telegramToken, chatId, oggPath);
      console.log('Enviado a Telegram.');
      consoleLeds.show();
    } catch (error: unknown) {
      console.error('No se pudo enviar a Telegram:', error);
    } finally {
      if (oggPath !== undefined) await unlink(oggPath).catch(() => undefined);
      if (needsEncode) await unlink(recordedPath).catch(() => undefined);
    }
  },

  onPlayHeld(pressed: boolean) {
    playButtonHeld = pressed;
    refreshPlayLed();
  },

  async onPlayLast() {
    if (isRecording) return;

    const unheard = pendingInboundOggs.shift();
    setUnheardAudio(pendingInboundOggs.length > 0);

    const oggPath = unheard ?? lastPlayedOgg;
    if (oggPath === undefined) {
      console.log('Todavía no llegó ningún audio del grupo.');
      return;
    }

    let wavPath: string | undefined;
    try {
      console.log(
        unheard === undefined
          ? 'Repitiendo el último audio del grupo…'
          : 'Reproduciendo audio nuevo del grupo…',
      );
      if (platform === 'raspberry') await audio.play(oggPath, { normalizePlayback: true });
       else {
        wavPath = await convertOggOpusToWav(oggPath);
        await audio.play(wavPath);
      }

      if (lastPlayedOgg !== undefined && lastPlayedOgg !== oggPath) await unlink(lastPlayedOgg).catch(() => undefined);

      lastPlayedOgg = oggPath;
    } catch (error: unknown) {
      console.error('No se pudo reproducir el audio:', error);
      if (unheard !== undefined) {
        pendingInboundOggs.unshift(unheard);
        setUnheardAudio(true);
      } else if (!(await fileExists(oggPath))) lastPlayedOgg = undefined;

    } finally {
      if (wavPath !== undefined) await unlink(wavPath).catch(() => undefined);
    }
  },
};

let stopButtons: StopListening;
let keyboardHint = '';
if (platform === 'mac') stopButtons = await listenToMacSpacebar(handlers);
 else {
  const stopGpio = listenToRaspberryButtons(handlers);

  // In `prod` the buttons are the only source of presses: a USB keyboard left in
  // the box (or a sound card that registers as HID) must not start a recording.
  if (mode === 'prod') stopButtons = stopGpio;
   else {
    const stopEvdev = await listenToLinuxKeyboard(handlers);
    const stopKeys = stopEvdev ?? listenToTerminalKeys(handlers);
    keyboardHint =
      stopEvdev !== undefined
        ? 'Teclado USB (evdev): mantén espacio para grabar, p para oír. '
        : process.stdin.isTTY
          ? 'Sin teclado evdev: espacio en esta terminal, p para oír. '
          : '';
    stopButtons = () => {
      stopGpio();
      stopKeys();
    };
  }
}

const telegram = listenToFamilyGroupVoices({
  token: telegramToken,
  chatId,
  botId: bot.id,
  async onVoiceDownloaded(localOggPath) {
    pendingInboundOggs.push(localOggPath);
    setUnheardAudio(true);
  },
});

const shutdown = (): void => {
  telegram.stop();
  stopButtons();
  recordLed.close();
  playLed.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`Family Voice Message Box — ${audio.name}`);
console.log(
  `Grupo: ${familyGroup.title ?? '(sin título)'}  CHAT_ID=${String(familyGroup.id)}`,
);

if (platform === 'raspberry') {
  await reportAlsaCaptureDevice();
  await reportAlsaPlaybackDevice();
  await primeAlsaCapture();
}

if (platform === 'mac') console.log(
    'Mantén pulsado espacio para grabar. Pulsa p para oír audios del grupo. ' +
      'LEDs en consola (●/○). Ctrl+C para salir.',
  );
 else console.log(
    `Botón grabar: GPIO ${process.env.GPIO_RECORD_BUTTON ?? process.env.GPIO_LINE ?? '17'} (LED ${String(recordLedLine)}). ` +
      `Botón oír: GPIO ${process.env.GPIO_PLAY_BUTTON ?? '22'} (LED ${String(playLedLine)}). ` +
      (mode === 'prod' ? 'Sin teclado: solo los botones. ' : keyboardHint) +
      'LEDs también en consola (●/○). Ctrl+C para salir.',
  );

/**
 * Used once at the end of startup. Not a `function` declaration: hoisting one
 * would lose the narrowing that already proved the token and chat id are set.
 */
const announceReady = async (): Promise<void> => {
  // The message means "I am listening", not "I booted": sending it while the
  // listener is still draining the backlog would put any instant reply in the
  // batch that gets discarded.
  await telegram.listening;

  try {
    await tgSendMessage(telegramToken, chatId, READY_MESSAGE);
    console.log(`Aviso enviado al grupo: ${READY_MESSAGE}`);
  } catch (error: unknown) {
    console.error('No se pudo avisar al grupo que la caja está lista:', error);
  }
};

// A `dev` run is a debugging session: the family would get a ping on every restart.
if (mode === 'prod') await announceReady();
else console.log('Modo dev: no se avisa al grupo.');

await new Promise(() => {
  // Stay running until SIGINT / SIGTERM.
});
