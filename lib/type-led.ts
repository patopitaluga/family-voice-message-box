/** Shared by `create-console-led-pair.ts`, `raspberry-gpio-led.ts`, `combine-leds.ts`, and `index.ts`. */
export type Led = {
  set(on: boolean): void;
  close(): void;
};
