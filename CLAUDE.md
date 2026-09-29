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

## Cuentas y movimientos (fase 2)
- `accounts.opening_balance` + movimientos = saldo. **El saldo nunca se guarda**, se calcula (`balanceSql` en `services/accounts.ts`, `accountBalance` en `domain/accounts.ts`). Positivo = tienes; negativo = debes (crédito/préstamo).
- `transactions`: `amount` siempre > 0; la dirección la dan `from_account_id` (sale) y `to_account_id` (entra). Gasto = solo from; ingreso = solo to; transferencia/pago = ambos; `ajuste` = uno de los dos (corrección de saldo, no es gasto ni ingreso).
- Transferencia hacia tarjeta ⇒ `pago_tarjeta` (`transferKind`). `summarize()` solo cuenta `gasto` como gasto.
- Borrado de movimientos = suave (`deleted_at`) para "Deshacer". Cuentas y categorías se **archivan**, no se borran.
- `ensureUserDefaults()` crea categorías predeterminadas y cuenta "Efectivo" al dar de alta a alguien (invitación, CLI, seed).
- Ids de la URL: `assertUuid()` antes de consultar (mal formado ⇒ "no encontrado", no error 500).
- Ojo Drizzle: dentro de `sql` usado en un `select`, las columnas salen sin tabla; en subconsultas calificar a mano (`"accounts"."id"`).
- Préstamos (`kind = prestamo`) aún no se pueden crear: llegan en la fase 6 con su tabla de amortización.

## Ingresos fijos y pagos recurrentes (fase 3)
- Una tabla `scheduled_items` (kind `ingreso`|`pago`) + `scheduled_occurrences` (qué pasó con cada fecha). **Sin renglón = pendiente**; `confirmado` con movimiento borrado = pendiente otra vez; `omitido` = "no aplica esta vez".
- Fechas: `src/domain/recurrence.ts` (`occurrences`, `nextOccurrence`, `isOccurrence`). Día 31 = último día del mes. Mensual/quincenal empiezan el 1° del mes de alta (para que cuenten las fechas de este mes); las demás frecuencias usan la fecha "próxima" como ancla.
- Confirmar crea un gasto/ingreso normal con `origin = "recurrente"`, `sourceId = item.id` y el nombre en `note`. Esos movimientos sí se pueden editar.
- `pg_advisory_xact_lock` por (programado, fecha) evita doble registro; siempre confirmar dentro de `db.transaction`.
- Automáticos (domiciliados): `ensureAutoSynced()` (`src/server/sync.ts`, cacheado por petición) los registra al abrir la app; nunca antes del día de alta, máximo 45 días atrás, y no recrea los que la persona borró.
- Lo confirmado/saltado HOY sigue visible con "Deshacer" (campo `actedAt`).

## Balance y semáforo (fase 4)
- Fórmula en `src/domain/balance.ts` (`computeMonthBalance`, pura y probada): ingresos (registrados + fijos pendientes) − compromisos (pagos fijos pendientes) − gastos del mes − variable esperado (presupuesto restante; 0 en meses pasados, completo en futuros). Solo `gasto` y `apoyo_enviado` son salidas; pagos de tarjeta/transferencias/ajustes no.
- Gasto "variable" = `gasto` con `origin = manual`.
- Semáforo: rojo si falta; amarillo si sobra ≤ `umbralAmarillo`% de los ingresos (10 por defecto, en `users.prefs`); verde si sobra más; "sin-datos" si no hay nada.
- `getMonthReport()` (`services/balance.ts`) junta movimientos, programados, presupuesto y preferencias de un mes.
- Presupuesto: tabla `budgets` (fila con `category_id` null = general). `saveBudgets` reemplaza todo.
- Letra y tema: en `users.prefs` y en cookies `fin_letra`/`fin_tema` (las lee el layout raíz → clase `letra-*` y `data-theme` en `<html>`). Se copian a la cookie al iniciar sesión.
- Asistente de primer uso: `/bienvenida?paso=1|2|3|listo`; `prefs.bienvenidaHecha` lo oculta.
- Barras de gráficas con SVG (atributo `width`), nunca `style` en línea (CSP).

## Tarjetas, compras a meses y préstamos (fases 5 y 6)
- Motor único `src/domain/amortization.ts` (sistema francés, cuota FIJA con IVA sobre intereses: se calcula con r×(1+IVA); último pago absorbe residuo). Tasas en puntos base enteros (24.5% = 2450). Referencia probada: $100,000, 24% anual, 12 meses → $9,455.96 sin IVA / $9,642.77 con IVA.
- Compra a meses (`installment_purchases`): al comprar se crea un movimiento `compra_msi` en la tarjeta por lo que falta pagar (NO cuenta como gasto). Las mensualidades se calculan del plan (no se guardan) y cuentan en el balance en su mes (cargada si su fecha pasó; compromiso si no), en la categoría de la compra. Ya iniciadas: `paidBefore` → "pagado previo", fuera de meses pasados.
- Tarjeta (`src/domain/credit-card.ts`, `services/cards.ts`): último corte, fecha límite, deuda al corte = saldo al corte − mensualidades futuras; pago para no generar intereses, mínimo Banxico (mayor de 1.5% saldo ó 1.25% límite + mensualidades), intereses si solo paga el mínimo. Todo "estimado". Anualidad = pago programado anual automático a la tarjeta (`accounts.annual_fee*`).
- Préstamos (`loans`, `loan_payments`): cuenta tipo `prestamo` con saldo = −capital. Pagar cuota ⇒ `pago_prestamo` (capital, cuenta como salida del mes) + `gasto` "Intereses y comisiones" (interés+IVA). Solo en orden; deshacer el último (`recordedAt`). Abono a capital: "plazo" (misma cuota) o "cuota" (mismo plazo); deshacer abono reconstruye al plazo original. Ya iniciados: `paidBefore` + saldo real opcional.
- Movimientos con origin `prestamo`/`msi` no se editan ni borran sueltos (`assertNotOwnedBySource`); se manejan desde el préstamo/compra.
- "Próximos pagos" unificado: `services/upcoming.ts` (programados + cuotas + recordatorio de tarjeta), `DueItem.source`.

## Apoyos familiares (fase 7)
- `support_transfers`: `enviado` → `recibido` | `cancelado`. Solo emisor y receptor lo ven (`getVisible` filtra por ambos); receptor debe ser de la MISMA familia.
- Al enviar: movimiento `apoyo_enviado` (origin `apoyo`) en la cuenta del emisor; cuenta como salida del mes (`spent.support`), no como consumo.
- Privacidad: quien envía NO ve las cuentas/deudas de quien recibe; solo marca "para una deuda". Quien recibe elige al confirmar: solo recibir, pagar su tarjeta, siguiente cuota o abono a capital (`receiveSupport`).
- Pendientes cuentan como ingreso esperado del receptor si `prefs.apoyosPendientesCuentan` (default true). "Todavía no" = `snoozedUntil` mañana.
- Deshacer confirmación: solo si el pago aplicado al préstamo sigue siendo el último (se compara `appliedTxId` con el capital del último pago).
- Recurrentes: `support_schedules`; `syncSupportSchedules` los genera al abrir la app el emisor O el receptor; índice único (schedule, fecha) + candado evita duplicados. Futuros del mes = compromiso (emisor) / esperado (receptor).
- Lo confirmado HOY sigue en la bandeja con "Deshacer".

## Recordatorios y pulido (fase 8)
- Web Push con VAPID (`services/push.ts`): opcional; sin llaves la app funciona igual. `notifyOnce(userId, key)` + `notification_log` evitan repetir avisos. Suscripciones que responden 404/410 se borran.
- `services/reminders.ts`: aviso diario (vence hoy/mañana, vencidos, tarjeta ≤3 días) y aviso inmediato de apoyos (misma llave `apoyo:<id>`, nunca duplicado). Lo dispara el servicio `cron` (imagen de herramientas) con `POST /api/cron/recordatorios` + `CRON_SECRET`; Nginx bloquea `/api/cron/` desde fuera.
- En pruebas el envío se sustituye con `setPushTransportForTests`.
- `pnpm push:keys` genera VAPID + CRON_SECRET (también `node scripts/push-keys.mjs` dentro del contenedor).
- Accesibilidad: `tests/e2e/accesibilidad.spec.ts` corre axe (WCAG 2.2 AA) en ~25 pantallas, claro y oscuro; no debe haber problemas serios/críticos. Agregar ahí cada pantalla nueva.
- `(app)/loading.tsx` hace que las respuestas lleguen en partes: un `notFound()` responde 200 con la página "No encontramos…" (en pruebas, verificar contenido, no el código HTTP).
- Checklist de prueba con la usuaria real: `docs/prueba-en-celular.md`.

## Gastos compartidos (fase 9a: cargos sueltos)
- `shared_debts`: una fila por persona que debe una parte de un gasto (`source_tx_id`) de otra (`owner_id`). Reparto por porcentaje (`percent_bp`) o monto; lo no repartido es del dueño. Lógica pura en `src/domain/shared.ts` (`computeShares`: con 100% exacto el residuo va en la última parte).
- Estados: `pendiente` → (quien debe: "Ya te pagué") `pagado` → (dueño: "Sí, me llegó") `recibido`; `rechazado` = "Esto no es mío" (vuelve a contar para el dueño; `dismissedAt` = ya vio el aviso). Cada paso se puede deshacer en orden.
- Balance sin doble conteo: el cargo completo queda en la cuenta del dueño (deuda real), pero `getMonthReport` le descuenta lo repartido (`ownShareTxs`, sin rechazados). Para quien debe, lo `pendiente` es compromiso del mes del cargo; al pagar se crea un `gasto` origin `compartido` (categoría "Gastos compartidos"). Al confirmar, el dueño recibe tx `reembolso` (NO es ingreso; puede entrar directo a la tarjeta y baja la deuda).
- Privacidad: quien debe solo ve concepto, monto, % y nombre del dueño (`SharedView.sourceTxId` es null para él); nunca la cuenta/tarjeta.
- Gasto de origen compartido: el monto no se edita (quitar reparto primero); la fecha sí y las partes la siguen. Borrarlo (suave) oculta las partes para todos; bloqueado si alguien ya pagó.
- Pendiente: fase 9b (compras a meses y préstamos compartidos: cada mensualidad/cuota se reparte) y 9c (tarjeta completa con reparto por defecto).

## UI
- Base 18px (`html { font-size: 112.5% }`, respeta el tamaño del sistema), botones ≥48px (usamos `min-h-14`), tokens de color en `globals.css` con modo oscuro. Nunca solo color: icono + texto.
- Componentes base en `src/components/ui.tsx`. Sin estilos inline (la CSP los bloquea).
- Otros: `MoneyKeypad` (teclado propio), `Choice` (opción grande tipo radio), `ConfirmButton` (diálogo antes de borrar/archivar), `StickyAction` (botón principal fijo encima de la barra inferior; usar cuando la lista puede empujar "Guardar" fuera de la vista), `TxList`, `MonthNav`.
- Tras guardar: pantalla de éxito con "Deshacer". Tras borrar: banner con "Deshacer".
- Texto que puede ser largo (nombres de cuenta, notas): que baje de renglón (`wrap-break-word`), no `truncate`.
- Probar a 360px de ancho (Playwright ya usa ese viewport).

## Comandos
```bash
pnpm db:up            # Postgres dev (5433) y de pruebas (5434, en RAM)
pnpm db:migrate       # aplica migraciones a la BD dev (.env.local)
pnpm db:seed          # hijo@demo.local / demo-hijo-1234 (admin), mama@demo.local / demo-mama-1234 (con cuentas y movimientos)
pnpm dev              # http://localhost:3000
pnpm db:generate --name <nombre>   # nueva migración tras cambiar src/server/db/schema.ts
pnpm test             # unitarias + integración (necesita db-test arriba)
pnpm test:unit        # solo unitarias
pnpm e2e              # Playwright móvil 360px (build + server.js standalone en :3100 contra db-test)
pnpm typecheck && pnpm lint
pnpm admin:create --familia "…" --nombre "…" --correo …
```
Producción: ver `README.md` (Docker Compose, Nginx del host en `127.0.0.1:3020`, respaldos age + rclone).

## Pruebas
- Integración en `tests/integration/` contra Postgres real; `tests/support/db.ts` (`resetDb`, `makeHousehold`).
- `tests/integration/authz-isolation.test.ts`: **cada fase nueva agrega casos** de "usuario A no puede leer/editar datos de B".
