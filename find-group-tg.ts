import { tgFindRecentFamilyGroups, tgGetMe } from './send-audio-tg.ts';

const telegramToken = process.env.TELEGRAM_TOKEN?.trim();

if (!telegramToken) throw new Error('TELEGRAM_TOKEN is not set');

const bot = await tgGetMe(telegramToken);
const botHandle =
  bot.username === undefined ? '(sin username)' : `@${bot.username}`;
const startCommand =
  bot.username === undefined ? '/start' : `/start@${bot.username}`;

console.log(`Bot del token: ${botHandle} — ${bot.firstName}`);
console.log(
  'Si no es el bot que esperabas, revisa TELEGRAM_TOKEN en .env.',
);
console.log('');
console.log('Haz esto AHORA (el comando espera ~60 s):');
console.log(`1) Abre el grupo familiar (donde ya está ${botHandle}).`);
console.log(`2) Escribe exactamente este comando: ${startCommand}`);
console.log('   (Un comando llega al bot aunque tenga privacidad de grupo activa.)');
console.log('3) Envía el mensaje y espera aquí en la terminal.');
console.log('');

const groups = await tgFindRecentFamilyGroups(telegramToken, 60);

if (groups.length === 0) {
  console.error('No llegó ninguna actualización de un grupo.');
  console.error('Revisa:');
  console.error(`- Que ${botHandle} esté en el grupo (Añadir miembros).`);
  console.error(
    `- Que el mensaje se envió EN EL GRUPO, no en el chat privado del bot.`,
  );
  console.error(`- Que enviaste el mensaje mientras este script esperaba.`);
  console.error(
    '- Que Group Privacy esté en Turn off (@BotFather → Bot Settings → Group Privacy).',
  );
  console.error('- Vuelve a ejecutar: npm run find:group');
  process.exit(1);
}

console.log('Grupos encontrados. Copia el CHAT_ID del grupo familiar a tu .env:');
console.log('');

for (const group of groups) {
  const title = group.title ?? '(sin título)';
  console.log(`  ${title}`);
  console.log(`  CHAT_ID=${String(group.id)}`);
  console.log('');
}
