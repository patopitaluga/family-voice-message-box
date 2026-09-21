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

/** Used in `index.ts`. */
export type FamilyVoiceListener = {
  /**
   * Resolves once the backlog has been drained and the loop is really polling.
   * `index.ts` waits for it before telling the family the box is ready, so that
   * a voice note sent right after that message cannot land in the discarded backlog.
   */
  listening: Promise<void>;
  /** Stops the loop and aborts the in-flight long-poll. */
  stop: () => void;
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
 */
export function listenToFamilyGroupVoices(
  options: FamilyVoiceListenerOptions,
): FamilyVoiceListener {
  let stopped = false;
  let offset: number | undefined;
  let inFlight: AbortController | undefined;

  // Replaced synchronously by the executor below; the no-op only keeps TypeScript
  // from seeing a variable used before assignment.
  let markListening = (): void => undefined;
  const listening = new Promise<void>((resolve) => {
    markListening = resolve;
  });

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

  /**
   * Discards pending updates so startup does not replay old voices.
   * Retries instead of giving up: at boot the network is often not up yet, and
   * a single failure here used to kill the listener for the whole session.
   */
  const drainBacklog = async (): Promise<void> => {
    while (!stopped) try {
        const drained = await fetchUpdates(0);
        offset = drained.nextOffset;
        return;
      } catch (error: unknown) {
        if (stopped) return;
        if (error instanceof Error && error.name === 'AbortError') return;
        console.error('Aún no se puede escuchar el grupo; se reintenta:', error);
        await sleep(2000);
      }
  };

  const loop = async (): Promise<void> => {
    await ensureTempDir();
    await drainBacklog();
    markListening();

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

  void loop().catch((error: unknown) => {
    // Everything recoverable is already retried inside the loop, so reaching here
    // means the box cannot receive voices at all. Say so and let startup finish:
    // recording still works, and a hung promise would hide the failure.
    console.error('El listener del grupo familiar se detuvo:', error);
    markListening();
  });

  return {
    listening,
    stop: (): void => {
      stopped = true;
      inFlight?.abort();
      markListening();
    },
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
