import { mkdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createAudioDevice,
  resolveBoxMode,
} from './audio/create-audio-device.ts';
import { findLatestRecordingPath } from './audio/latest-recording.ts';
import { convertWavToOggOpus } from './audio/wav-to-ogg-opus.ts';
import { listenToMacSpacebar } from './input/mac-spacebar.ts';
import { listenToRaspberryButton } from './input/raspberry-button.ts';
import { assertRaspberryPiOs } from './platform/assert-raspberry-pi-os.ts';
import { tgRequireFamilyGroup, tgSendVoice } from './send-audio-tg.ts';

const telegramToken = process.env.TELEGRAM_TOKEN?.trim();
const chatId = process.env.CHAT_ID?.trim();

if (!telegramToken) {
  throw new Error('TELEGRAM_TOKEN is not set');
}
if (!chatId) {
  throw new Error('CHAT_ID is not set');
}

await tgRequireFamilyGroup(telegramToken, chatId);

const mode = resolveBoxMode();

if (mode === 'raspberry') {
  assertRaspberryPiOs();
}

const audio = createAudioDevice(mode);

await mkdir('recordings', { recursive: true });

let currentRecordingPath: string | undefined;
let recordingStartedAt: number | undefined;
let isRecording = false;

const handlers = {
  async onPress() {
    if (isRecording) {
      return;
    }

    currentRecordingPath = join(
      'recordings',
      `mensaje-${String(Date.now())}.wav`,
    );
    console.log('Grabando…');
    await audio.startRecording(currentRecordingPath);
    recordingStartedAt = Date.now();
    isRecording = true;
  },

  async onRelease() {
    if (!isRecording) {
      return;
    }

    isRecording = false;
    await audio.stopRecording();

    const path = currentRecordingPath;
    const startedAt = recordingStartedAt;
    currentRecordingPath = undefined;
    recordingStartedAt = undefined;

    const durationMs =
      startedAt === undefined ? undefined : Date.now() - startedAt;

    let sizeLabel = 'tamaño desconocido';
    if (path !== undefined) {
      try {
        const { size } = await stat(path);
        if (size < 1024) {
          sizeLabel = `${String(size)} B`;
        } else if (size < 1024 * 1024) {
          sizeLabel = `${(size / 1024).toFixed(1)} KB`;
        } else {
          sizeLabel = `${(size / (1024 * 1024)).toFixed(2)} MB`;
        }
      } catch {
        sizeLabel = 'archivo no encontrado';
      }
    }

    let durationLabel = 'duración desconocida';
    if (durationMs !== undefined) {
      const seconds = durationMs / 1000;
      if (seconds < 60) {
        durationLabel = `${seconds.toFixed(1)} s`;
      } else {
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
        if (oggPath !== undefined) {
          await unlink(oggPath).catch(() => undefined);
        }
      }
    }
  },

  async onPlayLast() {
    if (isRecording) {
      return;
    }

    const latestPath = await findLatestRecordingPath();
    if (!latestPath) {
      console.log('No hay grabaciones para reproducir.');
      return;
    }

    console.log(`Reproduciendo ${latestPath}`);
    await audio.play(latestPath);
  },
};

const stopListening =
  mode === 'mac'
    ? await listenToMacSpacebar(handlers)
    : listenToRaspberryButton(handlers);

const shutdown = (): void => {
  stopListening();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`Family Voice Message Box — ${audio.name}`);

if (mode === 'mac') {
  console.log(
    'Mantén pulsado espacio para grabar. Pulsa p para oír la última. Ctrl+C para salir.',
  );
} else {
  console.log(
    `Esperando el botón (GPIO ${process.env.GPIO_LINE ?? '17'}). Ctrl+C para salir.`,
  );
}

await new Promise(() => {
  // Stay running until SIGINT / SIGTERM.
});
