import { tgRequireFamilyGroup, tgSendMessage } from './send-audio-tg.ts';

const telegramToken = process.env.TELEGRAM_TOKEN?.trim();
const chatId = process.env.CHAT_ID?.trim();

if (!telegramToken) throw new Error('TELEGRAM_TOKEN is not set');

if (!chatId) throw new Error('CHAT_ID is not set');

const group = await tgRequireFamilyGroup(telegramToken, chatId);
const groupLabel = group.title ?? String(group.id);

console.log(`Enviando pong al grupo «${groupLabel}» (${String(group.id)})…`);
await tgSendMessage(telegramToken, chatId, 'pong');
console.log('pong enviado al grupo familiar.');
