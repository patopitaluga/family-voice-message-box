/**
 * Fans one `Led.set` / `close` out to several LEDs (GPIO + consola in `index.ts`).
 */
import type { Led } from './type-led.ts';

/** Used in `index.ts` to drive GPIO and console LEDs together. */
export function combineLeds(...leds: Led[]): Led {
  return {
    set(on: boolean): void {
      for (const led of leds) led.set(on);
    },
    close(): void {
      for (const led of leds) led.close();
    },
  };
}
