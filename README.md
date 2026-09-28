# Mis Finanzas (familiar)

App web instalable en el celular (PWA) para llevar las finanzas de cada persona de la familia y responder de un vistazo: **¿me alcanza el dinero este mes?**

- Next.js 16 + TypeScript + Tailwind · PostgreSQL 17 + Drizzle · pnpm
- Docker Compose: `app`, `db` (sin puertos expuestos), `backup` (respaldos cifrados)
- Nginx del VPS como proxy HTTPS hacia `127.0.0.1:3020`

---

## Desarrollo local

Requisitos: Node 22+, pnpm 11 (`corepack enable`), Docker.

```bash
pnpm install
pnpm db:up          # Postgres de desarrollo (5433) y de pruebas (5434)
pnpm db:migrate
pnpm db:seed        # usuarios de ejemplo
pnpm dev            # http://localhost:3000
```

Usuarios de ejemplo: `hijo@demo.local` / `demo-hijo-1234` (administra) y `mama@demo.local` / `demo-mama-1234`.

`.env.local` (ya incluido para desarrollo, no se sube a git):

```
DATABASE_URL=postgres://finanzas:finanzas@127.0.0.1:5433/finanzas
APP_URL=http://localhost:3000
COOKIE_SECURE=false
```

### Pruebas

```bash
pnpm test        # unitarias + integración (requiere pnpm db:up)
pnpm e2e         # navegador móvil 360px (primera vez: pnpm exec playwright install chromium)
pnpm typecheck && pnpm lint
```

---

## Despliegue en el VPS

El VPS ya está endurecido y tiene Docker y Nginx. El puerto 3000 está ocupado, por eso la app usa **3020** (configurable con `APP_HOST_PORT`).

### 1. Código y configuración

```bash
git clone git@github.com:chuvakatsup/finanzas-familiar.git
cd finanzas-familiar
cp .env.example .env
nano .env        # llenar APP_DOMAIN, APP_URL, POSTGRES_PASSWORD, BACKUP_AGE_RECIPIENT
chmod 600 .env
mkdir -p backups && chown 1000:1000 backups   # o el uid que pongas en BACKUP_UID
```

Contraseña de BD: `openssl rand -hex 32` (solo letras y números, porque va dentro de una URL).

### 2. Llave de cifrado de respaldos (age)

Los respaldos se cifran con una **llave pública**; la privada **nunca** debe quedarse en el VPS.

En tu computadora (o cualquier equipo con `age`):

```bash
age-keygen -o finanzas-backup-key.txt
# Muestra: Public key: age1....
```

- Copia la línea `age1...` en `BACKUP_AGE_RECIPIENT` del `.env` del VPS.
- Guarda `finanzas-backup-key.txt` en un lugar seguro (gestor de contraseñas + una copia offline). **Sin esta llave no se pueden restaurar los respaldos.**

### 3. Levantar

```bash
docker compose up -d --build
docker compose ps                        # app y db deben decir (healthy)
curl -s 127.0.0.1:3020/api/health        # {"ok":true}
```

Las migraciones de BD se aplican solas cada vez que arranca la app.

### 4. Nginx + HTTPS

```bash
sudo cp deploy/nginx/finanzas.conf /etc/nginx/sites-available/finanzas.conf
sudo sed -i 's/finanzas.midominio.com/TU-SUBDOMINIO/g' /etc/nginx/sites-available/finanzas.conf
sudo ln -s /etc/nginx/sites-available/finanzas.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d TU-SUBDOMINIO
sudo nginx -t && sudo systemctl reload nginx
```

El DNS del subdominio (registro A/AAAA) debe apuntar al VPS antes de correr certbot.

### 5. Crear la familia y su administrador

```bash
docker compose exec app node scripts/create-admin.mjs \
  --familia "Familia Pérez" --nombre "Daniel" --correo daniel@correo.com
```

Imprime un enlace (vale 24 h) para que el admin cree su contraseña desde el celular. Después, desde **Más → Mi familia**, el admin invita a los demás con un enlace que se puede mandar por WhatsApp.

¿Alguien olvidó su contraseña? El admin entra a **Más → Mi familia** y toca "Crear enlace para contraseña nueva".

### Actualizar

```bash
git pull
docker compose up -d --build
docker image prune -f
```

---

## Respaldos

- Diario a la hora `BACKUP_TIME` (hora de Mazatlán), en `./backups/{daily,weekly,monthly}`.
- Retención: 7 diarios, 4 semanales (domingos), 3 mensuales (día 1).
- Formato: `pg_dump` comprimido → cifrado con `age` → `finanzas_AAAA-MM-DD_HHMM.dump.age`.
- Respaldo manual en cualquier momento: `docker compose exec backup backup.sh`
- Ver logs: `docker compose logs backup`

### Copia fuera del VPS (rclone)

Pendiente de elegir destino. Cuando se decida (Backblaze B2, Cloudflare R2, Google Drive, etc.):

1. En tu computadora: `rclone config` y crea el remoto (p. ej. `b2`).
2. Copia el archivo generado (`~/.config/rclone/rclone.conf`) al VPS en `docker/backup/rclone/rclone.conf` y `chmod 600`.
3. En `.env`: `RCLONE_REMOTE=b2:mi-bucket/finanzas`.
4. `docker compose up -d backup` y prueba: `docker compose exec backup backup.sh`.

La copia usa `rclone copy` (nunca borra en el destino). Configura la retención en el propio servicio de almacenamiento (reglas de ciclo de vida). Como los archivos están cifrados, el proveedor no puede leerlos.

### Restaurar

> ⚠️ Esto **reemplaza** la base de datos actual con el contenido del respaldo.

1. Sube la llave privada temporalmente al VPS (p. ej. `/root/finanzas-backup-key.txt`, `chmod 600`).
2. Elige el archivo: `ls backups/daily backups/weekly backups/monthly`
3. Restaura (pide escribir `SI` para confirmar):

   ```bash
   docker compose run --rm \
     -v /root/finanzas-backup-key.txt:/run/age-key.txt:ro \
     backup restore.sh /backups/daily/finanzas_2026-09-28_0315.dump.age
   docker compose restart app
   ```

4. **Borra la llave privada del VPS**: `shred -u /root/finanzas-backup-key.txt`

Para restaurar en otro servidor: levanta el proyecto con un `.env` nuevo, copia el `.dump.age` a `./backups/` y sigue los mismos pasos.

Procedimiento probado: respaldo → borrado de datos → restauración, con conteo de registros idéntico.

---

## Monitoreo

- Docker revisa `/api/health` cada 30 s; si la app cae, `restart: unless-stopped` la levanta.
- Recomendado: un monitor externo gratuito (UptimeRobot, Uptime Kuma) contra `https://TU-SUBDOMINIO/api/health` que te avise por correo/Telegram.
- Opcional: `BACKUP_PING_URL` (p. ej. healthchecks.io) avisa si un día no hubo respaldo.
- Los logs rotan solos (3 archivos de 10 MB por contenedor): `docker compose logs -f app`.

## Seguridad (resumen)

- BD solo en red interna de Docker, sin puertos al host. App solo en `127.0.0.1`.
- Contenedores sin root, sistema de archivos de solo lectura, `cap_drop: ALL`, `no-new-privileges`, límites de CPU/memoria, imágenes con versión fija.
- Contraseñas con argon2id; sesiones en cookie HttpOnly/Secure/SameSite=Lax (en BD solo el hash del token).
- Límite de intentos: 5 fallos por correo o 20 por IP en 15 minutos → pausa de 15 minutos (además del límite de Nginx).
- Cabeceras: CSP con nonce, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- Registro solo por invitación. Auditoría de cambios en `audit_log`.
- No se guardan números de tarjeta, CVV ni datos bancarios: solo alias y, opcionalmente, últimos 4 dígitos.
