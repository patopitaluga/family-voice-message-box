/**
 * Console stand-ins for the record/play LEDs (used in `index.ts` on every platform).
 * Same `Led.set` path as GPIO, so `start:dev` shows software LED state without hardware.
 */
import type { Led } from './type-led.ts';

/** Used in `index.ts`. */
export type ConsoleLedPair = {
  record: Led;
  play: Led;
  /** Re-prints the current LED line (e.g. after other console logs). */
  show(): void;
};

/** Used in `index.ts`. */
export function createConsoleLedPair(): ConsoleLedPair {
  let recordOn = false;
  let playOn = false;

  const paint = (): void => {
    console.log(
      `LEDs  grabar ${recordOn ? '●' : '○'}  oír ${playOn ? '●' : '○'}`,
    );
  };

  paint();

  return {
    record: {
      set(on: boolean): void {
        recordOn = on;
        paint();
      },
      close(): void {
        // no-op
      },
    },
    play: {
      set(on: boolean): void {
        playOn = on;
        paint();
      },
      close(): void {
        // no-op
      },
    },
    show: paint,
  };
}
