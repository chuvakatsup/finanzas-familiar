"use client";

import { type ReactNode, useRef } from "react";

/**
 * Botón que pide confirmación en una ventana grande antes de enviar su formulario.
 * Debe ir DENTRO del <form> que se quiere enviar.
 */
export function ConfirmButton({
  children,
  title,
  message,
  confirmLabel,
  cancelLabel = "No, regresar",
  variant = "danger",
}: {
  children: ReactNode;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "danger" | "secondary";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const style =
    variant === "danger"
      ? "bg-danger-bg text-danger border-2 border-danger"
      : "bg-surface text-text border-2 border-border";
  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={`inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-5 text-lg font-semibold ${style}`}
      >
        {children}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-surface p-0 text-text backdrop:bg-black/60"
      >
        <div className="flex flex-col gap-4 p-5">
          <h2 id="confirm-title" className="text-2xl font-bold">
            {title}
          </h2>
          <div className="text-lg">{message}</div>
          <button
            type="submit"
            onClick={() => dialogRef.current?.close()}
            className="min-h-14 rounded-2xl bg-danger px-5 text-lg font-semibold text-on-danger"
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => dialogRef.current?.close()}
            className="min-h-14 rounded-2xl border-2 border-border bg-surface px-5 text-lg font-semibold"
          >
            {cancelLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
