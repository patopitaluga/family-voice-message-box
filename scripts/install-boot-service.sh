#!/usr/bin/env bash
# Installs and enables the systemd unit so `npm start` runs on boot (Raspberry Pi).
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Este script es solo para Raspberry Pi OS (Linux)." >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta con sudo: sudo ./scripts/install-boot-service.sh" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_USER="${SUDO_USER:-${USER}}"
# Prefer the login user's PATH (nvm, fnm, etc.); root's PATH often lacks node.
if [[ -n "${SUDO_USER:-}" ]]; then
  NODE_BIN="$(sudo -u "${SERVICE_USER}" -H bash -lc 'command -v node' 2>/dev/null || true)"
else
  NODE_BIN="$(command -v node || true)"
fi

if [[ -z "${NODE_BIN}" ]]; then
  echo "No se encontró node en el PATH. Instala Node.js ≥ 24.7.0 e intenta de nuevo." >&2
  exit 1
fi

if [[ ! -f "${APP_DIR}/.env" ]]; then
  echo "Falta ${APP_DIR}/.env (copia .env.example y completa TELEGRAM_TOKEN y CHAT_ID)." >&2
  exit 1
fi

if [[ ! -f "${APP_DIR}/node_modules/.package-lock.json" ]] && [[ ! -d "${APP_DIR}/node_modules" ]]; then
  echo "Falta node_modules. Como usuario ${SERVICE_USER} ejecuta: cd ${APP_DIR} && npm install" >&2
  exit 1
fi

UNIT_SRC="${APP_DIR}/systemd/family-voice-message-box.service"
UNIT_DST="/etc/systemd/system/family-voice-message-box.service"

sed \
  -e "s|__APP_DIR__|${APP_DIR}|g" \
  -e "s|__USER__|${SERVICE_USER}|g" \
  -e "s|__NODE__|${NODE_BIN}|g" \
  "${UNIT_SRC}" > "${UNIT_DST}"

# Ensure the login user can use audio + GPIO without being root.
usermod -aG audio,gpio "${SERVICE_USER}" 2>/dev/null || true

systemctl daemon-reload
systemctl enable --now family-voice-message-box.service

echo "Servicio instalado y activo."
echo "  Estado:  systemctl status family-voice-message-box"
echo "  Logs:    journalctl -u family-voice-message-box -f"
echo "  Parar:   sudo systemctl stop family-voice-message-box"
echo "Si acabas de agregar grupos audio/gpio, reinicia la sesión (o la Pi) para que apliquen."
