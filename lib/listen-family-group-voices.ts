/**
 * Long-polls the family group for new voice notes (not from the bot itself).
 * Used in `index.ts` to light the play LED and queue files under `temp/`.
 */
import {
  tgDownloadFile,
  tgGetFilePath,
} from '../send-audio-tg.ts';
import { ensureTempDir, tempPath } from './temp-dir.ts';

export type FamilyVoiceListenerOptions = {
  token: string;
  chatId: string;
  botId: number;
  /** Called with a local OGG path after each new family voice is downloaded. */
  onVoiceDownloaded: (localOggPath: string) => void | Promise<void>;
};

type TgUpdate = {
  update_id: number;
  message?: {
    chat?: { id: number };
    from?: { id: number; is_bot?: boolean };
    voice?: { file_id: string; file_unique_id: string };
  };
};

/**
 * Used in `index.ts`.
 * Skips backlog on start; ignores the bot's own outbound voices.
 * Returns a stop function (also aborts the in-flight long-poll).
 */
export function listenToFamilyGroupVoices(
  options: FamilyVoiceListenerOptions,
): () => void {
  let stopped = false;
  let offset: number | undefined;
  let inFlight: AbortController | undefined;

  const fetchUpdates = async (
    timeoutSec: number,
  ): Promise<{ updates: TgUpdate[]; nextOffset: number | undefined }> => {
    const params = new URLSearchParams({
      timeout: String(timeoutSec),
      allowed_updates: JSON.stringify(['message']),
    });
    if (offset !== undefined) params.set('offset', String(offset));

    inFlight = new AbortController();
    const response = await fetch(
      `https://api.telegram.org/bot${options.token}/getUpdates?${params.toString()}`,
      { signal: inFlight.signal },
    );
    const data = (await response.json()) as {
      ok: boolean;
      description?: string;
      result?: TgUpdate[];
    };

    if (!data.ok || data.result === undefined) throw new Error(
        data.description ?? `Telegram getUpdates failed (${String(response.status)})`,
      );

    let nextOffset = offset;
    for (const update of data.result) nextOffset = update.update_id + 1;

    return { updates: data.result, nextOffset };
  };

  const loop = async (): Promise<void> => {
    await ensureTempDir();

    // Discard pending updates so startup does not replay old voices.
    const drained = await fetchUpdates(0);
    offset = drained.nextOffset;

    while (!stopped) try {
        const { updates, nextOffset } = await fetchUpdates(30);
        offset = nextOffset;

        for (const update of updates) {
          if (stopped) break;
          await handleUpdate(options, update);
        }
      } catch (error: unknown) {
        if (stopped) break;
        if (error instanceof Error && error.name === 'AbortError') break;
        console.error('Telegram listener error:', error);
        await sleep(2000);
      }
  };

  void loop();

  return (): void => {
    stopped = true;
    inFlight?.abort();
  };
}

/** Used only inside `listenToFamilyGroupVoices`. */
async function handleUpdate(
  options: FamilyVoiceListenerOptions,
  update: TgUpdate,
): Promise<void> {
  const message = update.message;
  if (message?.voice === undefined) return;
  if (message.chat === undefined) return;
  if (String(message.chat.id) !== String(options.chatId)) return;

  const from = message.from;
  if (from !== undefined && (from.id === options.botId || from.is_bot === true)) return;

  const filePath = await tgGetFilePath(options.token, message.voice.file_id);
  const localOggPath = tempPath(
    `in-${message.voice.file_unique_id}-${String(Date.now())}.ogg`,
  );
  await tgDownloadFile(options.token, filePath, localOggPath);
  console.log('Audio nuevo del grupo familiar.');
  await options.onVoiceDownloaded(localOggPath);
}

/** Used only inside `listenToFamilyGroupVoices`. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
