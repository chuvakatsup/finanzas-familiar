import { type NextRequest, NextResponse } from "next/server";

// Debe coincidir con SESSION_COOKIE / SESSION_DAYS de src/server/auth.
// (El proxy no importa módulos del servidor para mantenerse ligero.)
const SESSION_COOKIE = "fin_sesion";
const SESSION_MAX_AGE = 60 * 86_400;

/** Rutas que se ven sin sesión. */
const PUBLIC_PREFIXES = ["/login", "/invitacion/", "/restablecer/"];

function buildCsp(nonce: string) {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  // Redirección optimista: la validación real de la sesión se hace en el servidor (requireUser).
  if (!token && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  // Renueva la vigencia de la cookie con cada visita (la fecha real de vencimiento vive en la BD).
  if (token && request.method === "GET") {
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE !== "false",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Todo menos API, estáticos de Next, archivos de /public y el service worker.
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|offline.html|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
