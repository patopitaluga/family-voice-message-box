import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Returned by `tgGetChat`; used when checking that `CHAT_ID` is a family group. */
export type TgChat = {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
};

/** Returned by `tgGetMe`; printed in `find-group-tg.ts` to verify the token. */
export type TgBotIdentity = {
  id: number;
  firstName: string;
  username?: string;
};

/**
 * Used in `find-group-tg.ts`.
 * Calls Telegram `getMe` to identify which bot the token belongs to.
 */
export async function tgGetMe(token: string): Promise<TgBotIdentity> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getMe`,
  );
  const data = (await response.json()) as {
    ok: boolean;
    description?: string;
    result?: {
      id: number;
      first_name: string;
      username?: string;
    };
  };

  if (!data.ok || data.result === undefined) throw new Error(
      data.description ?? `Telegram getMe failed (${String(response.status)})`,
    );

  return {
    id: data.result.id,
    firstName: data.result.first_name,
    username: data.result.username,
  };
}

/**
 * Used in `tgRequireFamilyGroup`.
 * Calls Telegram `getChat`.
 */
export async function tgGetChat(
  token: string,
  chatId: string | number,
): Promise<TgChat> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(String(chatId))}`,
  );
  const data = (await response.json()) as {
    ok: boolean;
    description?: string;
    result?: {
      id: number;
      type: TgChat['type'];
      title?: string;
    };
  };

  if (!data.ok || data.result === undefined) throw new Error(
      data.description ?? `Telegram getChat failed (${String(response.status)})`,
    );

  return {
    id: data.result.id,
    type: data.result.type,
    title: data.result.title,
  };
}

/**
 * Used in `ping-tg.ts`, `index.ts`, and `send-last-tg.ts`.
 * Ensures `CHAT_ID` is a group/supergroup (the family Telegram group), not a DM.
 */
export async function tgRequireFamilyGroup(
  token: string,
  chatId: string | number,
): Promise<TgChat> {
  const chat = await tgGetChat(token, chatId);

  if (chat.type === 'group' || chat.type === 'supergroup') return chat;

  const kind =
    chat.type === 'private'
      ? 'un chat privado con el bot'
      : `un chat de tipo "${chat.type}"`;

  throw new Error(
    `CHAT_ID no es un grupo: es ${kind}. Pon en .env el chat_id del grupo de Telegram de la familia.`,
  );
}

/**
 * Used in `find-group-tg.ts`.
 * Reads bot updates (`getUpdates`) and returns unique group/supergroup chats.
 * Pass `waitSeconds` to long-poll while the user mentions the bot in the group.
 */
export async function tgFindRecentFamilyGroups(
  token: string,
  waitSeconds = 0,
): Promise<TgChat[]> {
  const params = new URLSearchParams({
    timeout: String(waitSeconds),
    allowed_updates: JSON.stringify(['message', 'my_chat_member']),
  });
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?${params.toString()}`,
  );
  const data = (await response.json()) as {
    ok: boolean;
    description?: string;
    result?: Array<{
      message?: {
        chat?: {
          id: number;
          type: TgChat['type'];
          title?: string;
        };
      };
      my_chat_member?: {
        chat?: {
          id: number;
          type: TgChat['type'];
          title?: string;
        };
      };
    }>;
  };

  if (!data.ok || data.result === undefined) throw new Error(
      data.description ?? `Telegram getUpdates failed (${String(response.status)})`,
    );

  const byId = new Map<number, TgChat>();

  for (const update of data.result) {
    const chat = update.message?.chat ?? update.my_chat_member?.chat;
    if (chat === undefined) continue;

    if (chat.type !== 'group' && chat.type !== 'supergroup') continue;

    byId.set(chat.id, {
      id: chat.id,
      type: chat.type,
      title: chat.title,
    });
  }

  return [...byId.values()];
}

/**
 * Used in `ping-tg.ts`.
 * Sends a plain text message via Telegram `sendMessage`.
 */
export async function tgSendMessage(
  token: string,
  chatId: string | number,
  content: string,
): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage?chat_id=${encodeURIComponent(String(chatId))}&text=${encodeURIComponent(content)}`,
  );
  const data = (await response.json()) as { ok: boolean; description?: string };

  if (!data.ok) throw new Error(
      data.description ?? `Telegram sendMessage failed (${String(response.status)})`,
    );

}

/**
 * Used in `index.ts` and `send-last-tg.ts`.
 * Sends an existing OGG/Opus file as a Telegram voice note (`sendVoice`).
 */
export async function tgSendVoice(
  token: string,
  chatId: string | number,
  voicePath: string,
): Promise<void> {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append(
    'voice',
    new Blob([await readFile(voicePath)], { type: 'audio/ogg' }),
    path.basename(voicePath),
  );

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendVoice`,
    { method: 'POST', body: form },
  );
  const data = (await response.json()) as {
    ok: boolean;
    description?: string;
  };

  if (!data.ok) throw new Error(
      data.description ?? `Telegram sendVoice failed (${String(response.status)})`,
    );

}
