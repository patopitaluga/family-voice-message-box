#!/usr/bin/env bash
# Raspberry Pi: USB mic choppy-audio tweaks.
# 1) Kernel cmdline — no USB autosuspend, USB 1.1 clock (dwc_otg.speed=1).
# 2) /etc/asound.conf — dsnoop capture at 48 kHz, then ALSA_DEVICE=mic in .env.
#
#   sudo ./scripts/fix-pi-usb-audio.sh
#   sudo reboot
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Este script es solo para Raspberry Pi OS (Linux)." >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta con sudo: sudo ./scripts/fix-pi-usb-audio.sh" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KERNEL_PARAMS=(usbcore.autosuspend=-1 dwc_otg.speed=1)

find_cmdline() {
  if [[ -f /boot/firmware/cmdline.txt ]]; then
    echo /boot/firmware/cmdline.txt
    return
  fi
  if [[ -f /boot/cmdline.txt ]]; then
    echo /boot/cmdline.txt
    return
  fi
  echo "No se encontró cmdline.txt (/boot/firmware/cmdline.txt ni /boot/cmdline.txt)." >&2
  exit 1
}

# Prints "CARD DEVICE" for the USB capture PCM (e.g. "2 0"). Never uses the
# Pi jack / HDMI: those have no capture. Your AB13X headset is typically card 2.
detect_usb_capture() {
  local line card device
  if [[ ! -r /proc/asound/pcm ]]; then
    echo "No se pudo leer /proc/asound/pcm." >&2
    exit 1
  fi

  while IFS= read -r line; do
    if [[ ! "$line" =~ ^([0-9]+)-([0-9]+): ]]; then
      continue
    fi
    card="${BASH_REMATCH[1]}"
    device="${BASH_REMATCH[2]}"
    if [[ "$line" != *capture* ]]; then
      continue
    fi
    if [[ "$line" =~ bcm2835|vc4|hdmi ]]; then
      continue
    fi
    if [[ "$line" =~ [Uu][Ss][Bb]|[Hh]eadset|[Mm]icrophone|[Pp]n[Pp] ]]; then
      echo "$((10#${card})) $((10#${device}))"
      return
    fi
  done < /proc/asound/pcm

  while IFS= read -r line; do
    if [[ ! "$line" =~ ^([0-9]+)-([0-9]+): ]]; then
      continue
    fi
    card="${BASH_REMATCH[1]}"
    device="${BASH_REMATCH[2]}"
    if [[ "$line" == *capture* ]] && [[ ! "$line" =~ bcm2835|vc4|hdmi ]]; then
      echo "$((10#${card})) $((10#${device}))"
      return
    fi
  done < /proc/asound/pcm

  echo "No hay un dispositivo de captura USB en /proc/asound/pcm. Enchufa el headset e intenta de nuevo." >&2
  exit 1
}

append_cmdline_params() {
  local file="$1"
  local line param changed=0
  line="$(tr -d '\n' < "$file")"
  line="${line%"${line##*[![:space:]]}"}"

  for param in "${KERNEL_PARAMS[@]}"; do
    if [[ " $line " == *" $param "* ]]; then
      echo "  Ya estaba: $param"
      continue
    fi
    line+=" $param"
    changed=1
    echo "  Añadido: $param"
  done

  if [[ "$changed" -eq 0 ]]; then
    echo "cmdline.txt no necesitaba cambios."
    return
  fi

  printf '%s\n' "$line" > "$file"
  echo "Escrito $file"
}

write_asound_conf() {
  local card="$1"
  local device="$2"
  local dest=/etc/asound.conf
  local hw="hw:${card},${device}"

  if [[ -f "$dest" ]]; then
    cp -a "$dest" "${dest}.bak.$(date +%Y%m%d%H%M%S)"
    echo "Respaldo de $dest"
  fi

  cat > "$dest" <<EOF
# Escrito por scripts/fix-pi-usb-audio.sh — captura USB a 48 kHz (dsnoop).
pcm.usb_mic {
    type dsnoop
    ipc_key 2048
    slave {
        pcm "${hw}"
        channels 1
        rate 48000
    }
}

pcm.mic {
    type plug
    slave.pcm "usb_mic"
}
EOF

  echo "Escrito $dest (slave ${hw}, no hw:1,0 — en esta Pi el USB de captura es card ${card})"
}

upsert_env_device() {
  local env_file="${APP_DIR}/.env"
  if [[ ! -f "$env_file" ]]; then
    echo "No hay ${env_file}; la caja no usará pcm.mic hasta que pongas ALSA_DEVICE=mic."
    return
  fi

  if grep -q '^ALSA_DEVICE=' "$env_file"; then
    sed -i 's/^ALSA_DEVICE=.*/ALSA_DEVICE=mic/' "$env_file"
  else
    printf '\nALSA_DEVICE=mic\n' >> "$env_file"
  fi
  echo "En ${env_file}: ALSA_DEVICE=mic"
}

warn_if_not_dwc_otg() {
  local model=""
  if [[ -r /proc/device-tree/model ]]; then
    model="$(tr -d '\0' < /proc/device-tree/model)"
  fi
  if [[ "$model" =~ Raspberry\ Pi\ [45] ]]; then
    echo "Aviso: ${model}."
    echo "  dwc_otg.speed=1 es del USB de la Pi 1/2/3; en Pi 4/5 suele ignorarse."
    echo "  usbcore.autosuspend=-1 sí aplica. Si el audio sigue cortado, mirá el voltaje."
  fi
}

CMDLINE="$(find_cmdline)"
read -r USB_CARD USB_DEVICE < <(detect_usb_capture)

echo "cmdline: $CMDLINE"
append_cmdline_params "$CMDLINE"
echo
echo "Captura USB detectada: card ${USB_CARD}, device ${USB_DEVICE}"
write_asound_conf "$USB_CARD" "$USB_DEVICE"
upsert_env_device
echo
warn_if_not_dwc_otg

echo "Listo. Reiniciá para que el cmdline aplique:"
echo "  sudo reboot"
echo "Después grabá un audio corto. Si sigue mal, buscá under-voltage:"
echo "  dmesg | grep -i voltage"
echo "  journalctl -b | grep -i under-voltage"
