/**
 * Updates the box from the Mac: ssh in, `git pull`, restart the service, show the log.
 * Run with `npm run update:pi` (reads `RASPBERRY_*` from `.env`).
 */
import { spawn } from 'node:child_process';

/** Used in `remoteScript` to keep paths and unit names safe inside the remote shell. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Used in `remoteScript`.
 * Anything not starting with `/` is taken as relative to the remote home, so the
 * common case needs no absolute path and no tilde (which quoting would break).
 */
function remoteCd(dir: string): string {
  return dir.startsWith('/') ? quote(dir) : `"$HOME"/${quote(dir)}`;
}

/**
 * Used in `main`.
 * `npm install` only runs when the pull actually moved the dependencies: on a Pi
 * it costs half a minute even when there is nothing to do.
 */
function remoteScript(dir: string, service: string): string {
  const unit = quote(service);

  return [
    'set -e',
    `cd ${remoteCd(dir)}`,
    'echo "==> git pull"',
    'before=$(git rev-parse HEAD)',
    'git pull --ff-only',
    'after=$(git rev-parse HEAD)',
    '[ "$before" = "$after" ] && echo "==> Ya estaba al día"',
    'if ! git diff --quiet "$before" "$after" -- package.json package-lock.json; then',
    '  echo "==> Cambiaron las dependencias: npm install"',
    '  npm install --no-audit --no-fund',
    'fi',
    `echo "==> Reiniciando ${service}"`,
    `sudo systemctl restart ${unit}`,
    'sleep 4',
    `systemctl is-active ${unit}`,
    `journalctl -u ${unit} -n 25 --no-pager`,
  ].join('\n');
}

/** Used at the bottom of this file. */
function main(): void {
  const host = process.env.RASPBERRY_HOST?.trim();
  if (host === undefined || host === '') {
    console.error(
      'Falta RASPBERRY_HOST en .env, por ejemplo: RASPBERRY_HOST=pi@raspberrypi.local',
    );
    process.exit(1);
  }

  const dir = process.env.RASPBERRY_DIR?.trim() ?? 'family-voice-message-box';
  const service =
    process.env.RASPBERRY_SERVICE?.trim() ?? 'family-voice-message-box';

  console.log(`Actualizando ${host}:${dir}`);

  // A login shell so `node` and `npm` are on PATH even when they come from nvm,
  // and `-t` so `sudo` can ask for the password if it is not passwordless yet.
  const remote = `bash -lc ${quote(remoteScript(dir, service))}`;
  const ssh = spawn('ssh', ['-t', host, remote], { stdio: 'inherit' });

  ssh.once('error', (error: unknown) => {
    console.error('No se pudo ejecutar ssh:', error);
    process.exit(1);
  });

  ssh.once('exit', (code) => {
    if (code === 0) {
      console.log('Caja actualizada.');
      return;
    }

    console.error(
      `La actualización falló (ssh salió con ${String(code)}). ` +
        'Si no pudo conectarse, comprueba RASPBERRY_HOST y que la Pi esté encendida en la red.',
    );
    process.exit(code ?? 1);
  });
}

main();
