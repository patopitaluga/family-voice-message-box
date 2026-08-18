/**
 * Detects whether this machine is a Raspberry Pi running Raspberry Pi OS
 * (device-tree model + `/etc/rpi-issue`). Used from `index.ts` for `npm start`.
 */
import { existsSync, readFileSync } from 'node:fs';

/**
 * Used in `isRaspberryPiOsHost`.
 * Device-tree model string on Pi hardware, e.g. "Raspberry Pi 5 Model B Rev 1.0".
 */
function readDeviceTreeModel(): string | undefined {
  try {
    return readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '');
  } catch {
    return undefined;
  }
}

/**
 * Used in `index.ts` for `npm start`.
 * True only on Raspberry Pi hardware with Raspberry Pi OS
 * (`/proc/device-tree/model` + `/etc/rpi-issue` from pi-gen images).
 */
export function isRaspberryPiOsHost(): boolean {
  const model = readDeviceTreeModel();
  const isRaspberryPiHardware = model?.includes('Raspberry Pi') ?? false;
  return isRaspberryPiHardware && existsSync('/etc/rpi-issue');
}
