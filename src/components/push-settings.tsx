"use client";

import { useEffect, useState, useTransition } from "react";
import { removePushSubscriptionAction, savePushSubscriptionAction, sendTestPushAction } from "@/server/actions/push";
import { Alert, Button } from "./ui";

type Status = "cargando" | "sin-soporte" | "instalar-iphone" | "bloqueado" | "apagado" | "activo";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Activar/desactivar recordatorios en ESTE celular, con instrucciones claras según el caso. */
export function PushSettings({ publicKey }: { publicKey: string | null }) {
  const [status, setStatus] = useState<Status>("cargando");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) return setStatus(isIos() && !isInstalled() ? "instalar-iphone" : "sin-soporte");
      if (Notification.permission === "denied") return setStatus("bloqueado");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setStatus(sub ? "activo" : "apagado");
    })().catch(() => setStatus("sin-soporte"));
  }, []);

  if (!publicKey) {
    return <p className="text-base text-muted">Los recordatorios todavía no están configurados en el servidor.</p>;
  }

  const activate = () =>
    start(async () => {
      setMsg(null);
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "bloqueado" : "apagado");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const r = await savePushSubscriptionAction(sub.toJSON());
      if (r.message) setMsg({ ok: false, text: r.message });
      else {
        setStatus("activo");
        setMsg({ ok: true, text: "Recordatorios activados en este celular." });
      }
    });

  const deactivate = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("apagado");
      setMsg({ ok: true, text: "Recordatorios desactivados en este celular." });
    });

  const test = () =>
    start(async () => {
      const r = await sendTestPushAction();
      setMsg(r.message ? { ok: false, text: r.message } : { ok: true, text: "Te mandamos un aviso de prueba." });
    });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-muted">
        Te avisamos por la mañana si tienes pagos que vencen hoy o mañana, y cuando alguien te manda un apoyo.
      </p>
      {status === "cargando" && <p className="text-lg">Revisando…</p>}
      {status === "instalar-iphone" && (
        <Alert kind="warn">
          En iPhone primero instala la app: toca <strong>Compartir</strong> (el cuadrito con flecha) y luego{" "}
          <strong>“Agregar a pantalla de inicio”</strong>. Ábrela desde ese icono y vuelve aquí.
        </Alert>
      )}
      {status === "sin-soporte" && <Alert kind="warn">Este navegador no puede recibir recordatorios.</Alert>}
      {status === "bloqueado" && (
        <Alert kind="warn">
          Las notificaciones están bloqueadas para esta app. Actívalas en los ajustes del celular (Notificaciones) y
          vuelve a intentar.
        </Alert>
      )}
      {status === "apagado" && (
        <Button type="button" onClick={activate} disabled={busy}>
          🔔 {busy ? "Activando…" : "Activar recordatorios"}
        </Button>
      )}
      {status === "activo" && (
        <>
          <p className="text-lg font-semibold text-ok">✅ Recordatorios activados en este celular</p>
          <Button type="button" variant="secondary" onClick={test} disabled={busy}>
            Mandarme un aviso de prueba
          </Button>
          <Button type="button" variant="secondary" onClick={deactivate} disabled={busy}>
            🔕 Desactivar
          </Button>
        </>
      )}
      {msg && <Alert kind={msg.ok ? "ok" : "danger"}>{msg.text}</Alert>}
    </div>
  );
}
