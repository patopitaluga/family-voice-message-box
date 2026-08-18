/**
 * CLI for `npm run play:last`: plays the newest WAV in `recordings/`
 * using the Mac or Raspberry audio control for the current platform.
 */
import {
  createAudioControl,
  parsePlatform,
} from './lib/create-audio-control.ts';
import { getLatestRecordingPath } from './lib/get-latest-recording-path.ts';

const platform = parsePlatform(
  process.argv[2] ?? (process.platform === 'darwin' ? 'mac' : 'raspberry'),
);
const audio = createAudioControl(platform);
const latestPath = await getLatestRecordingPath();

if (!latestPath) {
  console.error('No hay grabaciones en recordings/');
  process.exit(1);
}

console.log(`Reproduciendo ${latestPath}`);
await audio.play(latestPath);
