"use client";

import { useState } from "react";
import { TextField } from "./ui";

/** Campo de contraseña con botón grande "Ver" para evitar errores al escribir. */
export function PasswordField(props: {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
  autoComplete: "current-password" | "new-password";
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <TextField
        {...props}
        type={visible ? "text" : "password"}
        required
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        className="min-h-12 self-start rounded-xl px-3 text-base font-semibold text-primary underline underline-offset-4"
      >
        {visible ? "🙈 Ocultar contraseña" : "👁️ Ver contraseña"}
      </button>
    </div>
  );
}
