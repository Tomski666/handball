// Passwortschutz für die gesamte Seite. Läuft vor jeder Anfrage.
import { COOKIE_NAME, getCookie, readSession } from "../shared/session.js";

export default async (request, context) => {
  const secret = Netlify.env.get("SESSION_SECRET");
  const session = await readSession(secret, getCookie(request, COOKIE_NAME));
  if (session) return context.next();

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ fehler: "Nicht angemeldet" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const ziel = url.pathname + url.search;
  return Response.redirect(new URL(`/login.html?ziel=${encodeURIComponent(ziel)}`, url), 302);
};

export const config = {
  path: "/*",
  excludedPath: [
    "/login.html",
    "/login.js",
    "/styles.css",
    "/img/otv-logo-180.png",
    "/favicon.png",
    "/fonts/*",
    "/api/login",
  ],
};
