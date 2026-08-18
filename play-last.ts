import {
  createAudioDevice,
  resolveBoxMode,
} from './audio/create-audio-device.ts';
import { findLatestRecordingPath } from './audio/latest-recording.ts';

const mode = resolveBoxMode(
  process.argv[2] ?? (process.platform === 'darwin' ? 'mac' : 'raspberry'),
);
const audio = createAudioDevice(mode);
const latestPath = await findLatestRecordingPath();

if (!latestPath) {
  console.error('No hay grabaciones en recordings/');
  process.exit(1);
}

console.log(`Reproduciendo ${latestPath}`);
await audio.play(latestPath);
