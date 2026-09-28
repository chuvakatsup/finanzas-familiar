"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Sin service worker la app funciona igual; solo no habrá pantalla "sin internet".
      });
    }
  }, []);
  return null;
}
