@AGENTS.md

# Finanzas Familiar — guía para Claude Code

PWA familiar (Next.js 16) para responder "¿me alcanza el dinero este mes?". Usuaria clave: persona de 65+ → **sencillez > funciones**. Todo el texto visible en español sencillo, sin jerga.

## Reglas de trabajo
- Trabajar por fases (plan en `C:\Users\Equipo\.claude\plans\pasted-content-id-25bb-finanzas-twinkly-noodle.md`). Al terminar una fase: pruebas + cómo probar + **esperar visto bueno**.
- Gestor de paquetes: **pnpm** (nunca npm / package-lock). Builds nativos se aprueban en `pnpm-workspace.yaml` (`allowBuilds`).
- Git/GitHub: usuario **chuvakatsup** (no sistemaslebel). Repo: `chuvakatsup/finanzas-familiar` (privado).
- Next 16 cambió APIs: `middleware` → `src/proxy.ts`; `params`/`cookies()`/`headers()` son async. Leer `node_modules/next/dist/docs/` antes de usar algo nuevo.

## Arquitectura
- `src/domain/` — lógica pura de dinero y fechas (sin BD, sin Next). Aquí van balance, amortización, MSI, tarjetas, recurrencias. **Todo con pruebas.**
- `src/server/services/` — casos de uso. Reciben `db: DbOrTx` y un `Actor` como parámetros (testeables sin Next).
- `src/server/actions/` — Server Actions delgadas: validan con Zod, sacan el usuario de la cookie (`requireUser`) y llaman al servicio.
- `src/server/authz.ts` — `Actor`, `AuthzError`, `assertAdmin`. **Toda consulta filtra por `actor.id` o `actor.householdId`**; nunca confiar en ids del cliente sin comprobar pertenencia.
- `src/server/audit.ts` — `audit(tx, …)` en la misma transacción que el cambio (crear/editar/borrar de movimientos, apoyos, etc.).
- `src/lib/schemas/` — esquemas Zod compartidos cliente/servidor (no importar código de servidor aquí).
- `src/proxy.ts` — CSP con nonce por petición + redirección optimista a `/login`. Todas las páginas son dinámicas (`await connection()` en el layout raíz) para que el nonce funcione.
- Sesiones propias: token aleatorio en cookie `fin_sesion` (HttpOnly, SameSite=Lax, Secure), en BD solo SHA-256; 60 días deslizantes.
- Rate limit en BD (`auth_attempts`): 5 fallos/15 min por correo, 20 por IP. IP desde `X-Real-IP` (lo pone Nginx).
- Altas solo por invitación (enlace 7 días, un uso). Contraseña olvidada: el admin genera enlace de 24 h. Primer admin: `admin:create` (imprime enlace para crear contraseña).

## Dinero y fechas (no negociable)
- Dinero = **centavos enteros** (`bigint` mode number en BD, `Cents` en TS). Nunca float. Usar `src/domain/money.ts` (`parseMoney`, `formatMoney`, `mulRound`, `splitEvenly`: residuo al último pago).
- Zona horaria fija `America/Mazatlan` (`todayIso()`); columnas `date` para fechas sin hora.
- Sin doble conteo: gasto con tarjeta cuenta al comprar; pagar la tarjeta es transferencia. MSI cuenta una mensualidad por mes. Compras/préstamos ya iniciados guardan plazo total e histórico (`pagado_previo`) sin afectar meses pasados.

## UI
- Base 18px (`html { font-size: 112.5% }`, respeta el tamaño del sistema), botones ≥48px (usamos `min-h-14`), tokens de color en `globals.css` con modo oscuro. Nunca solo color: icono + texto.
- Componentes base en `src/components/ui.tsx`. Sin estilos inline (la CSP los bloquea).
- Probar a 360px de ancho (Playwright ya usa ese viewport).

## Comandos
```bash
pnpm db:up            # Postgres dev (5433) y de pruebas (5434, en RAM)
pnpm db:migrate       # aplica migraciones a la BD dev (.env.local)
pnpm db:seed          # hijo@demo.local / demo-hijo-1234 (admin), mama@demo.local / demo-mama-1234
pnpm dev              # http://localhost:3000
pnpm db:generate --name <nombre>   # nueva migración tras cambiar src/server/db/schema.ts
pnpm test             # unitarias + integración (necesita db-test arriba)
pnpm test:unit        # solo unitarias
pnpm e2e              # Playwright móvil 360px (build + start en :3100 contra db-test)
pnpm typecheck && pnpm lint
pnpm admin:create --familia "…" --nombre "…" --correo …
```
Producción: ver `README.md` (Docker Compose, Nginx del host en `127.0.0.1:3020`, respaldos age + rclone).

## Pruebas
- Integración en `tests/integration/` contra Postgres real; `tests/support/db.ts` (`resetDb`, `makeHousehold`).
- `tests/integration/authz-isolation.test.ts`: **cada fase nueva agrega casos** de "usuario A no puede leer/editar datos de B".
