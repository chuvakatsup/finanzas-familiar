"use client";

import { useEffect } from "react";
import { Button, ButtonLink, Card } from "@/components/ui";

/** Si algo falla, mensaje amable y opciones claras (nunca una pantalla técnica). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card className="mt-6">
      <p className="text-3xl" aria-hidden="true">
        😕
      </p>
      <h1 className="mt-2 text-2xl font-bold">Algo no salió bien</h1>
      <p className="mt-2 text-lg">
        No te preocupes, tu información está a salvo. Puede ser el internet. Intenta otra vez en un momento.
      </p>
      <div className="mt-5 flex flex-col gap-3">
        <Button type="button" onClick={reset}>
          Intentar de nuevo
        </Button>
        <ButtonLink href="/" variant="secondary">
          Ir a inicio
        </ButtonLink>
      </div>
      {error.digest && <p className="mt-4 text-sm text-muted">Código: {error.digest}</p>}
    </Card>
  );
}
