import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

// Componentes base: grandes, alto contraste, mínimo 48px de alto.

type Variant = "primary" | "secondary" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-surface text-text border-2 border-border hover:bg-surface-2",
  danger: "bg-danger-bg text-danger border-2 border-danger",
};

const buttonBase =
  "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-lg font-semibold transition-colors disabled:opacity-60";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${buttonBase} ${variants[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  children,
}: {
  href: string;
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${buttonBase} ${variants[variant]}`}>
      {children}
    </Link>
  );
}

export function TextField({
  label,
  name,
  errors,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
}) {
  const id = `f-${name}`;
  const describedBy = [hint && `${id}-hint`, errors?.length && `${id}-err`].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-lg font-semibold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-base text-muted">
          {hint}
        </p>
      )}
      <input
        id={id}
        name={name}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="min-h-14 rounded-xl border-2 border-border bg-surface px-4 text-lg text-text aria-[invalid=true]:border-danger"
        {...props}
      />
      {errors?.length ? (
        <p id={`${id}-err`} className="text-base font-medium text-danger">
          <span aria-hidden="true">⚠️ </span>
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-border bg-surface p-5 ${className}`}>{children}</section>
  );
}

export function Alert({ kind = "danger", children }: { kind?: "danger" | "ok" | "warn"; children: ReactNode }) {
  const styles = {
    danger: "bg-danger-bg text-danger border-danger",
    ok: "bg-ok-bg text-ok border-ok",
    warn: "bg-warn-bg text-warn border-warn",
  }[kind];
  const icon = { danger: "⚠️", ok: "✅", warn: "💡" }[kind];
  return (
    <div role={kind === "danger" ? "alert" : "status"} className={`rounded-xl border-2 p-4 text-lg ${styles}`}>
      <span aria-hidden="true">{icon} </span>
      {children}
    </div>
  );
}

export function PageTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <header className="mb-5">
      <h1 className="text-3xl font-bold leading-tight">{children}</h1>
      {subtitle && <p className="mt-1 text-lg text-muted">{subtitle}</p>}
    </header>
  );
}
