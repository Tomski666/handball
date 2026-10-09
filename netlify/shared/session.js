// Gemeinsame Sitzungslogik für Edge Function und API (Web Crypto, läuft in Deno und Node).
// Cookie-Inhalt: base64url(JSON {r: Rolle, exp: Ablauf}) + "." + HMAC-SHA256-Signatur

export const COOKIE_NAME = "otv_sitzung";
export const SESSION_DAYS = 120; // Eltern bleiben eine halbe Saison angemeldet

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSession(secret, role) {
  const payload = b64url(enc.encode(JSON.stringify({
    r: role,
    exp: Date.now() + SESSION_DAYS * 864e5,
  })));
  const sig = b64url(await hmac(secret, payload));
  return `${payload}.${sig}`;
}

export async function readSession(secret, token) {
  if (!secret || !token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = b64url(await hmac(secret, payload));
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    if (!data.exp || data.exp < Date.now()) return null;
    if (data.r !== "eltern" && data.r !== "kasse") return null;
    return data;
  } catch {
    return null;
  }
}

export function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function sessionCookie(value, maxAgeSeconds) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

// Passwortvergleich ohne frühen Abbruch
export async function passwordMatches(input, expected) {
  if (!expected) return false;
  const a = b64url(await hmac("pw", String(input || "")));
  const b = b64url(await hmac("pw", String(expected)));
  return timingSafeEqual(a, b);
}
