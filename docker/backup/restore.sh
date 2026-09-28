#!/bin/sh
# Restaura un respaldo cifrado SOBRE la base de datos actual (borra y recrea los objetos).
# Uso (desde el VPS, ver README):
#   docker compose run --rm -v /ruta/segura/age-key.txt:/run/age-key.txt:ro backup \
#     restore.sh /backups/daily/finanzas_2026-09-28_0315.dump.age
set -eu
file="${1:?Indica el archivo .dump.age a restaurar}"
key="${AGE_KEY_FILE:-/run/age-key.txt}"
[ -f "$file" ] || { echo "No existe $file" >&2; exit 1; }
[ -f "$key" ] || { echo "No encuentro la llave privada en $key" >&2; exit 1; }

echo "Se va a REEMPLAZAR la base de datos '${PGDATABASE}' con: $file"
echo "Escribe SI para continuar:"
read -r answer
[ "$answer" = "SI" ] || { echo "Cancelado."; exit 1; }

age --decrypt --identity "$key" --output /tmp/restore.bin "$file"
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction \
  --dbname "$PGDATABASE" /tmp/restore.bin
rm -f /tmp/restore.bin
echo "✔ Restauración terminada."
