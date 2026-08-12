import {
  createAudioDevice,
  resolveBoxMode,
  type BoxMode,
} from './audio/create-audio-device.ts';
import { findLatestRecordingPath } from './audio/latest-recording.ts';

/** Used in `play-last.ts` when npm does not pass a mode argv. */
function defaultBoxMode(): BoxMode {
  return process.platform === 'darwin' ? 'mac' : 'raspberry';
}

const mode = resolveBoxMode(process.argv[2] ?? defaultBoxMode());
const audio = createAudioDevice(mode);
const latestPath = await findLatestRecordingPath();

if (!latestPath) {
  console.error('No hay grabaciones en recordings/');
  process.exit(1);
}

console.log(`Reproduciendo ${latestPath}`);
await audio.play(latestPath);
