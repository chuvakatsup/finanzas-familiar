/** Zona horaria fija de la app. "Hoy" siempre se calcula aquí, no en la del servidor. */
export const APP_TIME_ZONE = "America/Mazatlan";

/** Fecha calendario como texto ISO "YYYY-MM-DD" (lo que guarda una columna `date`). */
export type IsoDate = string;

const isoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha de hoy en Mazatlán, p. ej. "2026-09-28". */
export function todayIso(now: Date = new Date()): IsoDate {
  return isoFormatter.format(now);
}

const longFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** "2026-09-28" → "lunes, 28 de septiembre" (la fecha ya es calendario; se formatea en UTC). */
export function formatLongDate(iso: IsoDate): string {
  return longFormatter.format(new Date(`${iso}T00:00:00Z`));
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
