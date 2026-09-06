/**
 * Startup wiring check for the illuminated buttons.
 * The play LED is otherwise only driven when a family voice note arrives, so a
 * miswired one looks identical to "nobody wrote yet" until someone does.
 */
import type { Led } from './type-led.ts';

/** Used in `index.ts` on `npm start`, before any button or Telegram listener starts. */
export async function blinkLedsOnce(leds: Led[], onMs = 2000): Promise<void> {
  for (const led of leds) led.set(true);

  await new Promise((resolve) => setTimeout(resolve, onMs));

  for (const led of leds) led.set(false);
}
