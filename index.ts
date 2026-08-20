import { stat, unlink } from 'node:fs/promises';
import {
  createAudioControl,
  parsePlatform,
} from './lib/create-audio-control.ts';
import { convertOggOpusToWav } from './lib/ogg-opus-to-wav.ts';
import { convertWavToOggOpus } from './lib/wav-to-ogg-opus.ts';
import { listenToMacSpacebar } from './lib/mac-spacebar.ts';
import { listenToRaspberryButtons } from './lib/raspberry-button.ts';
import { listenToLinuxKeyboard } from './lib/linux-keyboard.ts';
import { listenToTerminalKeys } from './lib/terminal-keys.ts';
import type { StopListening } from './lib/hold-to-talk.ts';
import { combineLeds } from './lib/combine-leds.ts';
import { createConsoleLedPair } from './lib/create-console-led-pair.ts';
import { createRaspberryGpioLed } from './lib/raspberry-gpio-led.ts';
import { isRaspberryPiOsHost } from './lib/is-raspberry-pi-os-host.ts';
import { listenToFamilyGroupVoices } from './lib/listen-family-group-voices.ts';
import { ensureTempDir, tempPath } from './lib/temp-dir.ts';
import {
  tgGetMe,
  tgRequireFamilyGroup,
  tgSendVoice,
} from './send-audio-tg.ts';

const telegramToken = process.env.TELEGRAM_TOKEN?.trim();
const chatId = process.env.CHAT_ID?.trim();

if (!telegramToken) throw new Error('TELEGRAM_TOKEN is not set');
if (!chatId) throw new Error('CHAT_ID is not set');

const familyGroup = await tgRequireFamilyGroup(telegramToken, chatId);
const bot = await tgGetMe(telegramToken);

const platform = parsePlatform();

if (platform === 'raspberry' && !isRaspberryPiOsHost()) {
  console.error('Este software está diseñado para correr en una Raspberry');
  process.exit(1);
}

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

let currentRecordingPath: string | undefined;
let recordingStartedAt: number | undefined;
let isRecording = false;

/** Local OGG paths from the family group, waiting to be played. */
const pendingInboundOggs: string[] = [];

/** Used when a family voice arrives or after play drains the queue. */
function setUnheardAudio(pending: boolean): void {
  playLed.set(pending);
}

const handlers = {
  async onPress() {
    if (isRecording) return;

    currentRecordingPath = tempPath(`out-${String(Date.now())}.wav`);
    console.log('Grabando…');
    recordLed.set(true);
    await audio.startRecording(currentRecordingPath);
    recordingStartedAt = Date.now();
    isRecording = true;
  },

  async onRelease() {
    if (!isRecording) return;

    isRecording = false;
    await audio.stopRecording();
    recordLed.set(false);

    const wavPath = currentRecordingPath;
    const startedAt = recordingStartedAt;
    currentRecordingPath = undefined;
    recordingStartedAt = undefined;

    const durationMs =
      startedAt === undefined ? undefined : Date.now() - startedAt;

    let sizeLabel = 'tamaño desconocido';
    if (wavPath !== undefined) try {
        const { size } = await stat(wavPath);
        if (size < 1024) sizeLabel = `${String(size)} B`;
         else if (size < 1024 * 1024) sizeLabel = `${(size / 1024).toFixed(1)} KB`;
         else sizeLabel = `${(size / (1024 * 1024)).toFixed(2)} MB`;

      } catch {
        sizeLabel = 'archivo no encontrado';
      }

    let durationLabel = 'duración desconocida';
    if (durationMs !== undefined) {
      const seconds = durationMs / 1000;
      if (seconds < 60) durationLabel = `${seconds.toFixed(1)} s`;
       else {
        const minutes = Math.floor(seconds / 60);
        const remainder = seconds - minutes * 60;
        durationLabel = `${String(minutes)} m ${remainder.toFixed(1)} s`;
      }
    }

    console.log(
      `Grabación lista (${durationLabel}, ${sizeLabel})`,
    );

    if (wavPath === undefined) return;

    let oggPath: string | undefined;
    try {
      console.log('Convirtiendo a OGG/Opus…');
      oggPath = await convertWavToOggOpus(wavPath, tempPath(`out-${String(Date.now())}.ogg`));
      await unlink(wavPath).catch(() => undefined);

      console.log('Enviando a Telegram…');
      await tgSendVoice(telegramToken, chatId, oggPath);
      console.log('Enviado a Telegram.');
      consoleLeds.show();
    } catch (error: unknown) {
      console.error('No se pudo enviar a Telegram:', error);
    } finally {
      if (oggPath !== undefined) await unlink(oggPath).catch(() => undefined);
      await unlink(wavPath).catch(() => undefined);
    }
  },

  async onPlayLast() {
    if (isRecording) return;

    const oggPath = pendingInboundOggs.shift();
    setUnheardAudio(pendingInboundOggs.length > 0);

    if (oggPath === undefined) {
      console.log('No hay audios nuevos del grupo para reproducir.');
      return;
    }

    let wavPath: string | undefined;
    try {
      console.log('Reproduciendo audio del grupo…');
      wavPath = await convertOggOpusToWav(oggPath);
      await audio.play(wavPath);
      await unlink(oggPath).catch(() => undefined);
    } catch (error: unknown) {
      console.error('No se pudo reproducir el audio:', error);
      pendingInboundOggs.unshift(oggPath);
      setUnheardAudio(true);
    } finally {
      if (wavPath !== undefined) await unlink(wavPath).catch(() => undefined);
    }
  },
};

let stopButtons: StopListening;
let raspberryKeyHint = '';
if (platform === 'mac') stopButtons = await listenToMacSpacebar(handlers);
 else {
  const stopGpio = listenToRaspberryButtons(handlers);
  const stopEvdev = await listenToLinuxKeyboard(handlers);
  const stopKeys = stopEvdev ?? listenToTerminalKeys(handlers);
  raspberryKeyHint =
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

const stopTelegram = listenToFamilyGroupVoices({
  token: telegramToken,
  chatId,
  botId: bot.id,
  async onVoiceDownloaded(localOggPath) {
    pendingInboundOggs.push(localOggPath);
    setUnheardAudio(true);
  },
});

const shutdown = (): void => {
  stopTelegram();
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

if (platform === 'mac') console.log(
    'Mantén pulsado espacio para grabar. Pulsa p para oír audios del grupo. ' +
      'LEDs en consola (●/○). Ctrl+C para salir.',
  );
 else console.log(
    `Botón grabar: GPIO ${process.env.GPIO_RECORD_BUTTON ?? process.env.GPIO_LINE ?? '17'} (LED ${String(recordLedLine)}). ` +
      `Botón oír: GPIO ${process.env.GPIO_PLAY_BUTTON ?? '22'} (LED ${String(playLedLine)}). ` +
      raspberryKeyHint +
      'LEDs también en consola (●/○). Ctrl+C para salir.',
  );

await new Promise(() => {
  // Stay running until SIGINT / SIGTERM.
});
