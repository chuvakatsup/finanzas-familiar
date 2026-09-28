#!/bin/sh
# Respaldo cifrado de la BD con retención 7 diarios / 4 semanales / 3 mensuales.
#   pg_dump (formato custom, comprimido) | age (llave pública) → /backups/daily/...
# Copia opcional fuera del VPS con rclone (nunca borra en el destino).
set -eu

DIR=/backups
KEEP_DAILY=7
KEEP_WEEKLY=4
KEEP_MONTHLY=3
: "${BACKUP_AGE_RECIPIENT:?Falta BACKUP_AGE_RECIPIENT}"

mkdir -p "$DIR/daily" "$DIR/weekly" "$DIR/monthly"
stamp="$(date +%Y-%m-%d_%H%M)"
name="finanzas_${stamp}.dump.age"
tmp="$DIR/daily/.${name}.partial"

echo "[backup] $(date -Iseconds) iniciando ${name}"
# El volcado sin cifrar solo vive en /tmp (tmpfs en RAM) y se borra al salir, pase lo que pase.
trap "rm -f /tmp/dump.bin \"$tmp\"" EXIT
if ! pg_dump --format=custom --compress=9 --no-owner --no-privileges > /tmp/dump.bin; then
  rm -f /tmp/dump.bin
  echo "[backup] ERROR en pg_dump" >&2
  exit 1
fi
age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$tmp" /tmp/dump.bin
rm -f /tmp/dump.bin
[ -s "$tmp" ] || { echo "[backup] ERROR: archivo vacío" >&2; rm -f "$tmp"; exit 1; }
mv "$tmp" "$DIR/daily/$name"

# Domingo → copia semanal; día 1 → copia mensual.
[ "$(date +%u)" = "7" ] && cp "$DIR/daily/$name" "$DIR/weekly/$name"
[ "$(date +%d)" = "01" ] && cp "$DIR/daily/$name" "$DIR/monthly/$name"

prune() { # carpeta cuantos
  ls -1 "$1"/finanzas_*.dump.age 2>/dev/null | sort -r | tail -n +"$(($2 + 1))" | while read -r f; do
    rm -f "$f"
  done
}
prune "$DIR/daily" "$KEEP_DAILY"
prune "$DIR/weekly" "$KEEP_WEEKLY"
prune "$DIR/monthly" "$KEEP_MONTHLY"

if [ -n "${RCLONE_REMOTE:-}" ]; then
  echo "[backup] copiando a ${RCLONE_REMOTE}"
  rclone copy "$DIR" "$RCLONE_REMOTE" --exclude ".*" --transfers 2
fi

if [ -n "${BACKUP_PING_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "$BACKUP_PING_URL" > /dev/null || true
fi
echo "[backup] listo: $(du -h "$DIR/daily/$name" | cut -f1) ${name}"
