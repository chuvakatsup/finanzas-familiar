export const CATEGORY_KINDS = ["gasto", "ingreso"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** Categorías con las que empieza cada persona (las puede renombrar, ocultar o agregar). */
export const DEFAULT_CATEGORIES: Record<CategoryKind, { name: string; icon: string }[]> = {
  gasto: [
    { name: "Comida", icon: "🍎" },
    { name: "Súper", icon: "🛒" },
    { name: "Transporte", icon: "🚌" },
    { name: "Casa", icon: "🏠" },
    { name: "Luz, agua y gas", icon: "💡" },
    { name: "Teléfono e internet", icon: "📱" },
    { name: "Salud", icon: "💊" },
    { name: "Ropa", icon: "👕" },
    { name: "Diversión", icon: "🎉" },
    { name: "Educación", icon: "📚" },
    { name: "Regalos", icon: "🎁" },
    { name: "Mascotas", icon: "🐾" },
    { name: "Intereses y comisiones", icon: "💸" },
    { name: "Otros", icon: "📦" },
  ],
  ingreso: [
    { name: "Sueldo", icon: "💼" },
    { name: "Pensión", icon: "🏛️" },
    { name: "Venta", icon: "🏷️" },
    { name: "Apoyo familiar", icon: "🤝" },
    { name: "Otros ingresos", icon: "💰" },
  ],
};

/** Iconos para elegir al crear una categoría. */
export const CATEGORY_ICON_CHOICES = [
  "🍎", "🛒", "🍽️", "☕", "🚌", "🚗", "⛽", "🏠", "💡", "💧", "🔥", "📱", "💊", "🏥", "👕", "🎉",
  "📚", "🎁", "🐾", "✂️", "🧹", "🛠️", "⛪", "✈️", "🎬", "💼", "🏛️", "🏷️", "🤝", "💰", "📦", "❤️", "💸",
] as const;
