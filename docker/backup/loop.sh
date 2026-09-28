#!/bin/sh
# Programador mínimo: corre backup.sh una vez al día a la hora BACKUP_TIME (hora local TZ).
# Sin cron ni root: revisa cada 30 s si ya toca.
set -eu
BACKUP_TIME="${BACKUP_TIME:-03:15}"
last_run=""
echo "[backup] programado diario a las ${BACKUP_TIME} (${TZ:-UTC})"
while true; do
  now_hm="$(date +%H:%M)"
  today="$(date +%F)"
  if [ "$now_hm" = "$BACKUP_TIME" ] && [ "$last_run" != "$today" ]; then
    last_run="$today"
    /usr/local/bin/backup.sh || echo "[backup] ERROR: el respaldo falló" >&2
  fi
  sleep 30
done
