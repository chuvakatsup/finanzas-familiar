import type { Metadata } from "next";
import { readDisplayPrefs } from "@/server/auth/display-prefs";
import { setLetraAction, setTemaAction } from "@/server/actions/settings";
import { Card, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Letra y colores" };

const LETRAS = [
  { value: "normal", label: "Normal", cls: "text-lg" },
  { value: "grande", label: "Grande", cls: "text-2xl" },
  { value: "muy-grande", label: "Muy grande", cls: "text-3xl" },
] as const;

const TEMAS = [
  { value: "sistema", label: "Como mi celular", icon: "📱" },
  { value: "claro", label: "Claro", icon: "☀️" },
  { value: "oscuro", label: "Oscuro", icon: "🌙" },
] as const;

function OptionButton({ selected, children }: { selected: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      aria-pressed={selected}
      className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 text-left font-semibold ${
        selected ? "border-primary bg-surface-2" : "border-border bg-surface"
      }`}
    >
      <span>{children}</span>
      <span aria-hidden="true" className="text-xl">
        {selected ? "✓" : ""}
      </span>
    </button>
  );
}

export default async function SettingsPage() {
  const { letra, tema } = await readDisplayPrefs();
  return (
    <>
      <PageTitle subtitle="Se guarda y se aplica al momento.">Letra y colores</PageTitle>

      <Card className="mb-5">
        <h2 className="mb-3 text-2xl font-bold">Tamaño de letra</h2>
        <div className="flex flex-col gap-3">
          {LETRAS.map((l) => (
            <form key={l.value} action={setLetraAction.bind(null, l.value)}>
              <OptionButton selected={letra === l.value}>
                <span className={l.cls}>Aa · {l.label}</span>
              </OptionButton>
            </form>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-2xl font-bold">Colores</h2>
        <div className="flex flex-col gap-3">
          {TEMAS.map((t) => (
            <form key={t.value} action={setTemaAction.bind(null, t.value)}>
              <OptionButton selected={tema === t.value}>
                <span className="text-lg">
                  <span aria-hidden="true">{t.icon} </span>
                  {t.label}
                </span>
              </OptionButton>
            </form>
          ))}
        </div>
      </Card>
    </>
  );
}
