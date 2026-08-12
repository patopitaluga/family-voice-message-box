import { existsSync, readFileSync } from 'node:fs';

/**
 * Used in `isRaspberryPiHardware`.
 * Device-tree model string on Pi hardware, e.g. "Raspberry Pi 5 Model B Rev 1.0".
 */
function readDeviceTreeModel(): string | undefined {
  try {
    return readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '');
  } catch {
    return undefined;
  }
}

/** Used in `assertRaspberryPiOs`. */
function isRaspberryPiHardware(): boolean {
  const model = readDeviceTreeModel();
  return model?.includes('Raspberry Pi') ?? false;
}

/**
 * Used in `assertRaspberryPiOs`.
 * `/etc/rpi-issue` is present on official Raspberry Pi OS images (pi-gen).
 */
function isRaspberryPiOs(): boolean {
  return existsSync('/etc/rpi-issue');
}

/**
 * Used in `index.ts` for `npm start`.
 * Exits immediately on anything that is not a Raspberry Pi running Raspberry Pi OS.
 */
export function assertRaspberryPiOs(): void {
  if (isRaspberryPiHardware() && isRaspberryPiOs()) {
    return;
  }

  console.error('Este software está diseñado para correr en una Raspberry');
  process.exit(1);
}
