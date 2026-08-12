import type { BoxMode } from '../audio/create-audio-device.ts';
import type { HoldToTalkHandlers, StopListening } from './hold-to-talk.ts';
import { listenToMacSpacebar } from './mac-spacebar.ts';
import { listenToRaspberryButton } from './raspberry-button.ts';

/**
 * Used in `index.ts`. Same one-button hold-to-talk on Pi (GPIO) and Mac (space).
 */
export async function listenForHold(
  mode: BoxMode,
  handlers: HoldToTalkHandlers,
): Promise<StopListening> {
  if (mode === 'mac') {
    return listenToMacSpacebar(handlers);
  }

  return listenToRaspberryButton(handlers);
}
