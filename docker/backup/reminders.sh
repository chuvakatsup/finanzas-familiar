#!/bin/sh
# Pide a la app el envío diario de recordatorios push a la hora REMINDER_TIME (hora local TZ).
# Corre en la red interna de Docker; la app valida CRON_SECRET.
set -eu
REMINDER_TIME="${REMINDER_TIME:-08:00}"
: "${CRON_SECRET:?Falta CRON_SECRET}"
last_run=""
echo "[cron] recordatorios diarios a las ${REMINDER_TIME} (${TZ:-UTC})"
while true; do
  now_hm="$(date +%H:%M)"
  today="$(date +%F)"
  if [ "$now_hm" = "$REMINDER_TIME" ] && [ "$last_run" != "$today" ]; then
    last_run="$today"
    curl -fsS -m 120 -X POST -H "Authorization: Bearer ${CRON_SECRET}" http://app:3000/api/cron/recordatorios \
      && echo " [cron] $(date -Iseconds) recordatorios enviados" \
      || echo "[cron] ERROR al pedir recordatorios" >&2
  fi
  sleep 30
done
