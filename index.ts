import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createAudioDevice,
  resolveBoxMode,
} from './audio/create-audio-device.ts';
import { findLatestRecordingPath } from './audio/latest-recording.ts';
import { listenForHold } from './input/listen-for-hold.ts';
import { assertRaspberryPiOs } from './platform/assert-raspberry-pi-os.ts';

/** Used in the "Grabación lista" log line. */
function formatDuration(milliseconds: number): string {
  const seconds = milliseconds / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes)} m ${remainder.toFixed(1)} s`;
}

/** Used in the "Grabación lista" log line. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const mode = resolveBoxMode();

if (mode === 'raspberry') {
  assertRaspberryPiOs();
}

const audio = createAudioDevice(mode);

await mkdir('recordings', { recursive: true });

let currentRecordingPath: string | undefined;
let recordingStartedAt: number | undefined;
let isRecording = false;

const stopListening = await listenForHold(mode, {
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
        sizeLabel = formatFileSize(size);
      } catch {
        sizeLabel = 'archivo no encontrado';
      }
    }

    const durationLabel =
      durationMs === undefined ? 'duración desconocida' : formatDuration(durationMs);

    console.log(
      `Grabación lista: ${path ?? '(sin archivo)'} (${durationLabel}, ${sizeLabel})`,
    );
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
});

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
