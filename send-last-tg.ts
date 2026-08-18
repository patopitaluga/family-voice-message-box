import { unlink } from 'node:fs/promises';
import { findLatestRecordingPath } from './audio/latest-recording.ts';
import { convertWavToOggOpus } from './audio/wav-to-ogg-opus.ts';
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

const latestPath = await findLatestRecordingPath();
if (!latestPath) {
  console.error('No hay grabaciones en recordings/');
  process.exit(1);
}

console.log(`Convirtiendo ${latestPath} a OGG/Opus…`);
const oggPath = await convertWavToOggOpus(latestPath);

try {
  console.log(`Enviando ${oggPath} a Telegram (${chatId})…`);
  await tgSendVoice(telegramToken, chatId, oggPath);
  console.log('Enviado.');
} finally {
  await unlink(oggPath).catch(() => undefined);
}
