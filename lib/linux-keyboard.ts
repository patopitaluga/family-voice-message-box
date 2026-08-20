/**
 * USB/local keyboard stand-in for GPIO buttons on Raspberry Pi (`npm start`).
 * Used from `index.ts`. Falls back to `terminal-keys.ts` when no evdev device opens.
 *
 * Uses the `input-event` package (Linux `/dev/input`, real key-up). Needs a
 * keyboard plugged into the Pi and membership in the `input` group.
 * SSH from another machine does not appear here — that is still a TTY.
 *
 * `input-event` names do not match the kernel: value 1 is emitted as
 * `keypress` (first down), value 2 as `keydown` (repeat), value 0 as `keyup`.
 */
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { HoldToTalkHandlers, StopListening } from './hold-to-talk.ts';

const require = createRequire(import.meta.url);

/** Linux `KEY_SPACE` (`input-event-codes.h`). */
const KEY_SPACE = 57;
/** Linux `KEY_P`. */
const KEY_P = 25;

type EvdevKeyEvent = {
  code: number;
};

type KeyboardDevice = {
  on(event: 'keypress' | 'keyup', listener: (ev: EvdevKeyEvent) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  input?: { destroy: () => void };
};

type InputEventPackage = {
  Keyboard: new (device: string) => KeyboardDevice;
};

/**
 * Used in `listenToLinuxKeyboard`.
 * `EVDEV_KEYBOARD` wins; otherwise `*-event-kbd` under `/dev/input/by-id` then `by-path`.
 */
async function listKeyboardDevices(): Promise<string[]> {
  const fromEnv = process.env.EVDEV_KEYBOARD?.trim();
  if (fromEnv !== undefined && fromEnv !== '') return [fromEnv];

  const found: string[] = [];
  for (const dir of ['/dev/input/by-id', '/dev/input/by-path']) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }

    for (const name of names) if (name.includes('event-kbd')) found.push(`${dir}/${name}`);

    if (found.length > 0) return found;
  }

  return found;
}

/**
 * Used in `index.ts` for `npm start` on Raspberry Pi.
 * Hold space to record; `p` plays. Returns `undefined` if no keyboard could be opened.
 */
export async function listenToLinuxKeyboard(
  handlers: HoldToTalkHandlers,
): Promise<StopListening | undefined> {
  let InputEvent: InputEventPackage;
  try {
    InputEvent = require('input-event') as InputEventPackage;
  } catch (error: unknown) {
    console.warn(
      'Paquete `input-event` no instalado. En la Pi: npm install',
      error,
    );
    return undefined;
  }

  const devices = await listKeyboardDevices();
  if (devices.length === 0) {
    console.warn(
      'No hay teclado evdev (`/dev/input/by-id/*-event-kbd`). Enchufa un teclado USB a la Pi ' +
        'y agrega tu usuario al grupo input: sudo usermod -aG input $USER (luego reinicia sesión). ' +
        'Opcional: EVDEV_KEYBOARD=/dev/input/eventN',
    );
    return undefined;
  }

  const keyboards: KeyboardDevice[] = [];
  for (const device of devices) try {
      keyboards.push(new InputEvent.Keyboard(device));
    } catch (error: unknown) {
      console.warn(
        `No se pudo abrir ${device}. ¿Grupo input? sudo usermod -aG input $USER`,
        error,
      );
    }

  if (keyboards.length === 0) return undefined;

  let held = false;
  let pressInFlight = false;
  let releaseWhilePressInFlight = false;
  let playInFlight = false;

  const finishRelease = (): void => {
    held = false;
    void Promise.resolve(handlers.onRelease()).catch((error: unknown) => {
      console.error(error);
    });
  };

  const onKeypress = (ev: EvdevKeyEvent): void => {
    if (ev.code === KEY_P) {
      if (held || pressInFlight || playInFlight || handlers.onPlayLast === undefined) return;

      playInFlight = true;
      void Promise.resolve(handlers.onPlayLast())
        .catch((error: unknown) => {
          console.error(error);
        })
        .finally(() => {
          playInFlight = false;
        });
      return;
    }

    if (ev.code !== KEY_SPACE) return;
    if (held || playInFlight) return;

    held = true;
    pressInFlight = true;
    void Promise.resolve(handlers.onPress())
      .catch((error: unknown) => {
        console.error(error);
      })
      .finally(() => {
        pressInFlight = false;
        if (releaseWhilePressInFlight) {
          releaseWhilePressInFlight = false;
          finishRelease();
        }
      });
  };

  const onKeyup = (ev: EvdevKeyEvent): void => {
    if (ev.code !== KEY_SPACE) return;
    if (!held) return;

    if (pressInFlight) {
      releaseWhilePressInFlight = true;
      return;
    }

    finishRelease();
  };

  for (const keyboard of keyboards) {
    keyboard.on('keypress', onKeypress);
    keyboard.on('keyup', onKeyup);
    keyboard.on('error', (error: Error) => {
      console.error('evdev keyboard error:', error);
    });
  }

  console.log(`Teclado evdev: ${devices.join(', ')}`);

  return () => {
    for (const keyboard of keyboards) try {
      keyboard.input?.destroy();
    } catch {
      // Device already gone.
    }
  };
}
