import { ButtonLink, Card } from "@/components/ui";

export default function NotFound() {
  return (
    <main id="contenido" className="mx-auto w-full max-w-md flex-1 px-4 py-10">
      <Card>
        <p className="text-3xl" aria-hidden="true">
          🔎
        </p>
        <h1 className="mt-2 text-2xl font-bold">No encontramos esta página</h1>
        <p className="mt-2 text-lg">Puede que ya no exista o que el enlace esté incompleto.</p>
        <div className="mt-5">
          <ButtonLink href="/">Ir a inicio</ButtonLink>
        </div>
      </Card>
    </main>
  );
}
