// Genera las llaves VAPID para los recordatorios push y un CRON_SECRET.
// Copia el resultado a tu .env (una sola vez; si cambias las llaves hay que reactivar avisos).
import { randomBytes } from "node:crypto";
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`CRON_SECRET=${randomBytes(24).toString("hex")}`);
