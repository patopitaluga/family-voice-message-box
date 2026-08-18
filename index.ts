import { mkdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createAudioControl,
  parsePlatform,
} from './lib/create-audio-control.ts';
import { getLatestRecordingPath } from './lib/get-latest-recording-path.ts';
import { convertWavToOggOpus } from './lib/wav-to-ogg-opus.ts';
import { listenToMacSpacebar } from './lib/mac-spacebar.ts';
import { listenToRaspberryButtons } from './lib/raspberry-button.ts';
import { createRaspberryGpioLed } from './lib/raspberry-gpio-led.ts';
import { isRaspberryPiOsHost } from './lib/is-raspberry-pi-os-host.ts';
import { tgRequireFamilyGroup, tgSendVoice } from './send-audio-tg.ts';

const telegramToken = process.env.TELEGRAM_TOKEN?.trim();
const chatId = process.env.CHAT_ID?.trim();

if (!telegramToken) throw new Error('TELEGRAM_TOKEN is not set');
if (!chatId) throw new Error('CHAT_ID is not set');

await tgRequireFamilyGroup(telegramToken, chatId);

const platform = parsePlatform();

if (platform === 'raspberry' && !isRaspberryPiOsHost()) {
  console.error('Este software está diseñado para correr en una Raspberry');
  process.exit(1);
}

const audio = createAudioControl(platform);

await mkdir('recordings', { recursive: true });

const gpioChip = process.env.GPIO_CHIP ?? 'gpiochip0';
const recordLedLine = Number(process.env.GPIO_RECORD_LED ?? '27');
const playLedLine = Number(process.env.GPIO_PLAY_LED ?? '23');

const recordLed =
  platform === 'raspberry'
    ? createRaspberryGpioLed(gpioChip, recordLedLine)
    : undefined;
const playLed =
  platform === 'raspberry'
    ? createRaspberryGpioLed(gpioChip, playLedLine)
    : undefined;

let currentRecordingPath: string | undefined;
let recordingStartedAt: number | undefined;
let isRecording = false;

/** Used when inbound family audio arrives (and at startup if a recording exists). */
function setUnheardAudio(pending: boolean): void {
  playLed?.set(pending);
}

if (platform === 'raspberry' && (await getLatestRecordingPath()) !== undefined) setUnheardAudio(true);


const handlers = {
  async onPress() {
    if (isRecording) return;

    currentRecordingPath = join(
      'recordings',
      `mensaje-${String(Date.now())}.wav`,
    );
    console.log('Grabando…');
    recordLed?.set(true);
    await audio.startRecording(currentRecordingPath);
    recordingStartedAt = Date.now();
    isRecording = true;
  },

  async onRelease() {
    if (!isRecording) return;

    isRecording = false;
    await audio.stopRecording();
    recordLed?.set(false);

    const path = currentRecordingPath;
    const startedAt = recordingStartedAt;
    currentRecordingPath = undefined;
    recordingStartedAt = undefined;

    const durationMs =
      startedAt === undefined ? undefined : Date.now() - startedAt;

    let sizeLabel = 'tamaño desconocido';
    if (path !== undefined) try {
        const { size } = await stat(path);
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
      `Grabación lista: ${path ?? '(sin archivo)'} (${durationLabel}, ${sizeLabel})`,
    );

    if (path !== undefined) {
      let oggPath: string | undefined;
      try {
        console.log('Convirtiendo a OGG/Opus…');
        oggPath = await convertWavToOggOpus(path);
        console.log('Enviando a Telegram…');
        await tgSendVoice(telegramToken, chatId, oggPath);
        console.log('Enviado a Telegram.');
      } catch (error: unknown) {
        console.error('No se pudo enviar a Telegram:', error);
      } finally {
        if (oggPath !== undefined) await unlink(oggPath).catch(() => undefined);

      }
    }
  },

  async onPlayLast() {
    if (isRecording) return;

    const latestPath = await getLatestRecordingPath();
    if (!latestPath) {
      console.log('No hay grabaciones para reproducir.');
      setUnheardAudio(false);
      return;
    }

    console.log(`Reproduciendo ${latestPath}`);
    await audio.play(latestPath);
    setUnheardAudio(false);
  },
};

const stopListening =
  platform === 'mac'
    ? await listenToMacSpacebar(handlers)
    : listenToRaspberryButtons(handlers);

const shutdown = (): void => {
  stopListening();
  recordLed?.close();
  playLed?.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`Family Voice Message Box — ${audio.name}`);

if (platform === 'mac') console.log(
    'Mantén pulsado espacio para grabar. Pulsa p para oír la última. Ctrl+C para salir.',
  );
 else console.log(
    `Botón grabar: GPIO ${process.env.GPIO_RECORD_BUTTON ?? process.env.GPIO_LINE ?? '17'} (LED ${String(recordLedLine)}). ` +
      `Botón oír: GPIO ${process.env.GPIO_PLAY_BUTTON ?? '22'} (LED ${String(playLedLine)}). Ctrl+C para salir.`,
  );

await new Promise(() => {
  // Stay running until SIGINT / SIGTERM.
});
