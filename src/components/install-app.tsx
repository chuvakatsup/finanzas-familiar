"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Botón "Instalar" en Android/Chrome; instrucciones en iPhone; aviso si ya está instalada. */
export function InstallApp() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [platform, setPlatform] = useState<"ios" | "otro" | "instalada">("otro");

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    // Se decide después de montar porque depende del navegador (no existe en el servidor).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(standalone ? "instalada" : /iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : "otro");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (platform === "instalada") {
    return <p className="text-lg font-semibold text-ok">✅ Ya tienes la app instalada en este celular.</p>;
  }
  if (platform === "ios") {
    return (
      <ol className="list-decimal space-y-2 pl-6 text-lg">
        <li>Abre esta página en <strong>Safari</strong>.</li>
        <li>
          Toca el botón <strong>Compartir</strong> (el cuadrito con una flecha hacia arriba).
        </li>
        <li>
          Elige <strong>“Agregar a pantalla de inicio”</strong> y luego <strong>Agregar</strong>.
        </li>
      </ol>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {evt ? (
        <Button
          type="button"
          onClick={async () => {
            await evt.prompt();
            setEvt(null);
          }}
        >
          📲 Instalar la app en este celular
        </Button>
      ) : (
        <ol className="list-decimal space-y-2 pl-6 text-lg">
          <li>En Chrome, toca los <strong>tres puntitos</strong> (arriba a la derecha).</li>
          <li>
            Elige <strong>“Instalar app”</strong> o <strong>“Agregar a pantalla principal”</strong>.
          </li>
        </ol>
      )}
    </div>
  );
}
