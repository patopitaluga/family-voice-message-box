import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const recordingsDir = 'recordings';

let names: string[];
try {
  names = await readdir(recordingsDir);
} catch {
  console.log(`No existe ${recordingsDir}/; nada que borrar.`);
  process.exit(0);
}

await Promise.all(
  names.map((name) =>
    rm(join(recordingsDir, name), { recursive: true, force: true }),
  ),
);

console.log(
  names.length === 0
    ? `${recordingsDir}/ ya estaba vacía.`
    : `Se borraron ${String(names.length)} elemento(s) de ${recordingsDir}/.`,
);
