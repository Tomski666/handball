// API der Elternseite: Login, Daten (Spiele, Standdienst, Catering, Trikots, Kasse ...) und Fotogalerie.
// Speicher: Netlify Blobs. Jeder Eintrag ist ein eigener Blob, damit gleichzeitige Eintragungen
// mehrerer Eltern sich nicht gegenseitig überschreiben.
import { getStore } from "@netlify/blobs";
import {
  COOKIE_NAME, SESSION_DAYS, createSession, getCookie, passwordMatches, readSession, sessionCookie,
} from "../shared/session.js";

const env = (k) => (globalThis.Netlify?.env?.get(k) ?? process.env[k]);
const daten = () => getStore({ name: "daten", consistency: "strong" });
const fotos = () => getStore({ name: "fotos", consistency: "strong" });

// ---------- Datenmodell ----------
const S = (max = 200) => ({ typ: "text", max });
const COLLECTIONS = {
  spiele: {
    schreiben: "kasse",
    felder: { datum: { typ: "datum", pflicht: true }, zeit: { typ: "zeit" }, gegner: { ...S(80), pflicht: true },
      heim: { typ: "bool" }, halle: S(80), hinweis: S(300) },
  },
  kader: {
    schreiben: "kasse",
    felder: { vorname: { ...S(30), pflicht: true }, nummer: S(3), reihenfolge: { typ: "zahl" } },
  },
  trainer: {
    schreiben: "kasse",
    felder: { name: { ...S(80), pflicht: true }, rolle: S(60), text: S(1500), reihenfolge: { typ: "zahl" } },
  },
  standdienst: {
    schreiben: "eltern", eigeneLoeschen: true,
    felder: { spielId: { ...S(40), pflicht: true }, name: { ...S(60), pflicht: true }, hinweis: S(120), reserve: { typ: "bool" } },
  },
  catering: {
    schreiben: "eltern", eigeneLoeschen: true,
    felder: { spielId: { ...S(40), pflicht: true }, artikel: { ...S(40), pflicht: true },
      name: { ...S(60), pflicht: true }, menge: S(60) },
  },
  trikots: {
    // Schlüssel = Spiel-ID. Eltern dürfen tauschen und "erledigt" setzen.
    schreiben: "eltern", upsert: true,
    felder: { familie: S(40), erledigt: { typ: "bool" }, notiz: S(120) },
  },
  fahrten: {
    // Fahrgemeinschaft: ein Elternteil bietet Plätze für ein Auswärtsspiel an
    schreiben: "eltern", eigeneLoeschen: true,
    felder: { spielId: { ...S(40), pflicht: true }, fahrer: { ...S(60), pflicht: true }, plaetze: { typ: "zahl", pflicht: true },
      treffpunkt: S(120), hinweis: S(160) },
  },
  mitfahrer: {
    schreiben: "eltern", eigeneLoeschen: true,
    felder: { fahrtId: { ...S(40), pflicht: true }, name: { ...S(40), pflicht: true }, eingetragenVon: S(60) },
  },
  kasse: {
    schreiben: "kasse",
    felder: { datum: { typ: "datum", pflicht: true }, art: { typ: "wahl", werte: ["einnahme", "ausgabe"], pflicht: true },
      betrag: { typ: "cent", pflicht: true }, zweck: { ...S(120), pflicht: true }, kategorie: S(40),
      kanal: S(30), spielId: S(40), beleg: S(120) },
  },
};

const STANDARD_EINSTELLUNGEN = {
  anfangsbestand: 85000, // in Cent
  anfangsdatum: "2026-10-09",
  teamText:
    "Text zur Mannschaft folgt. Hier stellen wir kurz vor, wer wir sind, wie die Saison läuft und was wir uns vorgenommen haben.",
  liga: "Regionsoberliga männliche C, Meisterrunde (Bergischer HK)",
  trainingszeiten: [
    { tag: "Dienstag", zeit: "17:30 bis 19:00 Uhr", halle: "Heiligenstock" },
    { tag: "Freitag", zeit: "18:00 bis 19:30 Uhr", halle: "Humboldt" },
  ],
  standdienstPlaetze: 2,
  reservePlaetze: 1,
  cateringArtikel: [
    { name: "Kuchen", bedarf: 2 },
    { name: "Muffins", bedarf: 2 },
    { name: "Laugengebäck", bedarf: 1 },
    { name: "Kaffee", bedarf: 1 },
    { name: "Milch", bedarf: 2 },
  ],
  kassenKategorien: ["Heimspiel-Catering", "Getränke OTV", "Einkauf Catering", "Mannschaftsfeier", "Geschenke", "Turnier/Fahrten", "Sonstiges"],
  kassenKanaele: ["Bar", "PayPal", "Überweisung", "Karte/SumUp"],
  widgetToken: "",
  handballNetUrl: "https://www.handball.net/team/95652?season_id=2627&phaseId=17411",
};

// Spielplan Saison 2026/27 (Regionsoberliga männliche C, Meisterrunde) und Kader nur mit Vornamen.
// Werden beim ersten Start angelegt bzw. per Datenstand-Abgleich ergänzt, ohne Bestehendes zu löschen.
const DATENSTAND = 3;
const STARTDATEN = {
  spiele: [
    { datum: "2026-10-10", zeit: "14:30", gegner: "Bergischer HC III", heim: true, halle: "OTV-Sporthalle", hinweis: "" },
    { datum: "2026-11-08", zeit: "12:00", gegner: "JSG Eller-Gerresheim C1J", heim: false, halle: "", hinweis: "" },
    { datum: "2026-11-15", zeit: "15:30", gegner: "DJK Unitas Haan II", heim: true, halle: "OTV-Sporthalle", hinweis: "" },
    { datum: "2026-11-21", zeit: "14:00", gegner: "Wermelskirchener TV", heim: false, halle: "", hinweis: "Datum bitte prüfen" },
    { datum: "2026-12-06", zeit: "14:15", gegner: "TSV Aufderhöhe", heim: true, halle: "OTV-Sporthalle", hinweis: "" },
    { datum: "2026-12-12", zeit: "15:00", gegner: "Luchse Düsseldorf C1J", heim: false, halle: "", hinweis: "" },
    { datum: "2026-12-20", zeit: "14:15", gegner: "HSG Rade/Herbeck", heim: true, halle: "OTV-Sporthalle", hinweis: "" },
    { datum: "2027-01-09", zeit: "13:45", gegner: "HSV Solingen-Gräfrath 76", heim: true, halle: "OTV-Sporthalle", hinweis: "" },
    { datum: "2027-01-24", zeit: "11:30", gegner: "Bergischer HC III", heim: false, halle: "", hinweis: "" },
    { datum: "2027-01-31", zeit: "14:00", gegner: "JSG Eller-Gerresheim C1J", heim: true, halle: "OTV-Sporthalle", hinweis: "" },
    { datum: "2027-02-07", zeit: "10:00", gegner: "DJK Unitas Haan II", heim: false, halle: "", hinweis: "" },
    { datum: "2027-02-14", zeit: "14:15", gegner: "Wermelskirchener TV", heim: true, halle: "OTV-Sporthalle", hinweis: "" },
    { datum: "2027-02-28", zeit: "12:30", gegner: "TSV Aufderhöhe", heim: false, halle: "", hinweis: "" },
    { datum: "2027-03-06", zeit: "15:45", gegner: "Luchse Düsseldorf C1J", heim: true, halle: "OTV-Sporthalle", hinweis: "" },
    { datum: "2027-03-13", zeit: "15:15", gegner: "HSG Rade/Herbeck", heim: false, halle: "", hinweis: "" },
  ],
  trainer: [
    { name: "Christoph Tillmanns", rolle: "Trainer", text: "", reihenfolge: 1 },
    { name: "Maurice Pfeifer", rolle: "Trainer", text: "", reihenfolge: 2 },
    { name: "Marte Kullenberg", rolle: "Trainer", text: "", reihenfolge: 3 },
    { name: "Joschka Siegert", rolle: "Trainer", text: "", reihenfolge: 4 },
  ],
  kader: [
    { vorname: "Christos", nummer: "", reihenfolge: 1 },
    { vorname: "Emil", nummer: "3", reihenfolge: 2 },
    { vorname: "Felix", nummer: "", reihenfolge: 3 },
    { vorname: "Jasper", nummer: "", reihenfolge: 4 },
    { vorname: "Jonas", nummer: "", reihenfolge: 5 },
    { vorname: "Jonathan", nummer: "18", reihenfolge: 6 },
    { vorname: "Jonne", nummer: "", reihenfolge: 7 },
    { vorname: "Lasse", nummer: "", reihenfolge: 8 },
    { vorname: "Levi", nummer: "", reihenfolge: 9 },
    { vorname: "Lian", nummer: "", reihenfolge: 10 },
    { vorname: "Mats", nummer: "16", reihenfolge: 11 },
    { vorname: "Mehyar", nummer: "", reihenfolge: 12 },
    { vorname: "Mika", nummer: "", reihenfolge: 13 },
    { vorname: "Nico", nummer: "", reihenfolge: 14 },
    { vorname: "Paul", nummer: "", reihenfolge: 15 },
    { vorname: "Piet", nummer: "1", reihenfolge: 16 },
    { vorname: "Semih", nummer: "", reihenfolge: 17 },
    { vorname: "Timon", nummer: "", reihenfolge: 18 },
    { vorname: "Titus", nummer: "", reihenfolge: 19 },
  ],
};

// ---------- Hilfen ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
const fehler = (text, status = 400) => json({ fehler: text }, status);
const neueId = () => Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 8);
const darf = (rolle, benoetigt) => rolle === "kasse" || (benoetigt === "eltern" && rolle === "eltern");

function pruefe(def, eingabe, teilweise = false) {
  const aus = {};
  for (const [feld, regel] of Object.entries(def.felder)) {
    let w = eingabe?.[feld];
    if (w === undefined || w === null || w === "") {
      if (regel.pflicht && !teilweise) throw new Error(`Feld „${feld}“ fehlt`);
      if (w === undefined && teilweise) continue;
      aus[feld] = regel.typ === "bool" ? false : regel.typ === "zahl" || regel.typ === "cent" ? 0 : "";
      continue;
    }
    switch (regel.typ) {
      case "text": aus[feld] = String(w).trim().slice(0, regel.max); break;
      case "datum": if (!/^\d{4}-\d{2}-\d{2}$/.test(w)) throw new Error("Datum ungültig"); aus[feld] = w; break;
      case "zeit": if (!/^\d{2}:\d{2}$/.test(w)) throw new Error("Uhrzeit ungültig"); aus[feld] = w; break;
      case "bool": aus[feld] = w === true || w === "true"; break;
      case "zahl": aus[feld] = Number.parseInt(w, 10) || 0; break;
      case "cent": {
        const c = Math.round(Number(w));
        if (!Number.isFinite(c) || c <= 0 || c > 10_000_000) throw new Error("Betrag ungültig");
        aus[feld] = c; break;
      }
      case "wahl": if (!regel.werte.includes(w)) throw new Error(`Wert für „${feld}“ ungültig`); aus[feld] = w; break;
    }
  }
  return aus;
}

async function liste(store, prefix) {
  const { blobs } = await store.list({ prefix: `${prefix}/` });
  const eintraege = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return eintraege.filter(Boolean);
}

async function abgleich(store, e) {
  // Ergänzt Spiele und Kader aus STARTDATEN, ohne vorhandene Einträge zu verändern oder zu löschen
  const norm = (x) => String(x).toLowerCase().replace(/\s+/g, " ").trim();
  const spiele = await liste(store, "spiele");
  for (const sp of STARTDATEN.spiele) {
    if (!spiele.some((x) => x.datum === sp.datum && norm(x.gegner) === norm(sp.gegner))) {
      const id = neueId();
      await store.setJSON(`spiele/${id}`, { id, ...sp, erstellt: new Date().toISOString() });
    }
  }
  const kader = await liste(store, "kader");
  for (const k of STARTDATEN.kader) {
    const vorhanden = kader.find((x) => norm(x.vorname) === norm(k.vorname));
    if (vorhanden) await store.setJSON(`kader/${vorhanden.id}`, { ...vorhanden, nummer: vorhanden.nummer || k.nummer, reihenfolge: k.reihenfolge });
    else {
      const id = neueId();
      await store.setJSON(`kader/${id}`, { id, ...k, erstellt: new Date().toISOString() });
    }
  }
  for (const t of await liste(store, "trainer")) {
    if (t.rolle === "Trainerin" && t.name.startsWith("Marte")) await store.setJSON(`trainer/${t.id}`, { ...t, rolle: "Trainer" });
  }
  const neu = { ...e, datenstand: DATENSTAND };
  // Datenstand 3: Standdienst mit 2 festen Plätzen und 1 Reserveplatz
  if ((e.datenstand || 1) < 3) {
    if (!e.standdienstPlaetze || e.standdienstPlaetze === 3) neu.standdienstPlaetze = 2;
    if (neu.reservePlaetze === undefined) neu.reservePlaetze = 1;
  }
  await store.setJSON("einstellungen", neu);
  return neu;
}

async function einstellungen(store) {
  const e = await store.get("einstellungen", { type: "json" });
  if (e && (e.datenstand || 1) < DATENSTAND) return { ...STANDARD_EINSTELLUNGEN, ...(await abgleich(store, e)) };
  if (e) return { ...STANDARD_EINSTELLUNGEN, ...e };
  // Erster Aufruf: Startdaten anlegen
  await store.setJSON("einstellungen", { ...STANDARD_EINSTELLUNGEN, datenstand: DATENSTAND });
  for (const [col, items] of Object.entries(STARTDATEN)) {
    for (const item of items) {
      const id = neueId();
      await store.setJSON(`${col}/${id}`, { id, ...item, erstellt: new Date().toISOString() });
    }
  }
  return { ...STANDARD_EINSTELLUNGEN, datenstand: DATENSTAND };
}

const oeffentlich = (eintrag, besitzer) => {
  const { besitzer: b, ...rest } = eintrag;
  return { ...rest, eigen: !!besitzer && b === besitzer };
};

// ---------- Handler ----------
export default async (request) => {
  const url = new URL(request.url);
  const teile = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const methode = request.method;
  const secret = env("SESSION_SECRET");

  if (!secret || !env("ELTERN_PASSWORT") || !env("KASSE_PASSWORT")) {
    return fehler("Seite noch nicht eingerichtet: Umgebungsvariablen fehlen (siehe README).", 500);
  }

  // Login ist die einzige Route ohne Sitzung
  if (teile[0] === "login" && methode === "POST") {
    const { passwort } = await request.json().catch(() => ({}));
    let rolle = null;
    if (await passwordMatches(passwort, env("KASSE_PASSWORT"))) rolle = "kasse";
    else if (await passwordMatches(passwort, env("ELTERN_PASSWORT"))) rolle = "eltern";
    if (!rolle) {
      await new Promise((r) => setTimeout(r, 800)); // bremst Durchprobieren
      return fehler("Passwort falsch", 401);
    }
    const token = await createSession(secret, rolle);
    return json({ rolle }, 200, { "set-cookie": sessionCookie(token, SESSION_DAYS * 86400) });
  }

  const sitzung = await readSession(secret, getCookie(request, COOKIE_NAME));
  if (!sitzung) return fehler("Nicht angemeldet", 401);
  const rolle = sitzung.r;
  const besitzer = (request.headers.get("x-besitzer") || "").slice(0, 64);

  // Schreibende Anfragen nur von der eigenen Seite
  if (methode !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return fehler("Ungültige Herkunft", 403);
  }

  try {
    if (teile[0] === "logout" && methode === "POST") {
      return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
    }

    const store = daten();

    // Gesamtzustand für die Seite
    if (teile[0] === "zustand" && methode === "GET") {
      const e = await einstellungen(store);
      const zustand = { rolle, einstellungen: e };
      await Promise.all(Object.keys(COLLECTIONS).map(async (col) => {
        zustand[col] = (await liste(store, col)).map((x) => oeffentlich(x, besitzer));
      }));
      return json(zustand);
    }

    if (teile[0] === "einstellungen" && methode === "PUT") {
      if (rolle !== "kasse") return fehler("Nur für die Kassenführung", 403);
      const alt = await einstellungen(store);
      const neu = await request.json();
      const erlaubt = Object.keys(STANDARD_EINSTELLUNGEN);
      const zusammen = { ...alt };
      for (const k of erlaubt) if (k in neu) zusammen[k] = neu[k];
      zusammen.anfangsbestand = Math.round(Number(zusammen.anfangsbestand)) || 0;
      zusammen.standdienstPlaetze = Math.min(10, Math.max(1, Number.parseInt(zusammen.standdienstPlaetze, 10) || 2));
      zusammen.reservePlaetze = Math.min(5, Math.max(0, Number.parseInt(zusammen.reservePlaetze, 10) || 0));
      await store.setJSON("einstellungen", zusammen);
      return json(zusammen);
    }

    // CRUD: /api/c/:col[/:id]
    if (teile[0] === "c" && COLLECTIONS[teile[1]]) {
      const col = teile[1];
      const def = COLLECTIONS[col];
      const id = teile[2];

      if (methode === "POST") {
        if (!darf(rolle, def.schreiben)) return fehler("Keine Berechtigung", 403);
        const werte = pruefe(def, await request.json());
        if (col === "fahrten" && (werte.plaetze < 1 || werte.plaetze > 8)) return fehler("Bitte 1 bis 8 freie Plätze angeben");
        if (col === "mitfahrer") {
          const fahrt = await store.get(`fahrten/${werte.fahrtId}`, { type: "json" });
          if (!fahrt) return fehler("Diese Fahrt gibt es nicht mehr", 404);
          const mit = (await liste(store, "mitfahrer")).filter((x) => x.fahrtId === werte.fahrtId);
          if (mit.length >= fahrt.plaetze) return fehler("Diese Fahrt ist schon voll", 409);
          if (mit.some((x) => x.name.toLowerCase() === werte.name.toLowerCase())) return fehler(`${werte.name} fährt hier schon mit`, 409);
        }
        if (col === "standdienst") {
          const e = await einstellungen(store);
          const belegt = (await liste(store, "standdienst")).filter((x) => x.spielId === werte.spielId && !!x.reserve === werte.reserve).length;
          const max = werte.reserve ? e.reservePlaetze : e.standdienstPlaetze;
          if (belegt >= max) return fehler(werte.reserve ? "Der Reserveplatz ist schon vergeben" : "Alle Plätze für dieses Spiel sind schon vergeben", 409);
        }
        const neu = { id: neueId(), ...werte, besitzer, erstellt: new Date().toISOString() };
        await store.setJSON(`${col}/${neu.id}`, neu);
        return json(oeffentlich(neu, besitzer), 201);
      }

      if (methode === "PUT" && id) {
        if (!darf(rolle, def.schreiben)) return fehler("Keine Berechtigung", 403);
        const alt = await store.get(`${col}/${id}`, { type: "json" });
        if (!alt && !def.upsert) return fehler("Nicht gefunden", 404);
        if (alt && def.eigeneLoeschen && rolle !== "kasse" && alt.besitzer !== besitzer) {
          return fehler("Nur eigene Einträge können geändert werden", 403);
        }
        const werte = pruefe(def, await request.json(), true);
        const neu = { ...(alt || { id, erstellt: new Date().toISOString() }), ...werte, geaendert: new Date().toISOString() };
        await store.setJSON(`${col}/${id}`, neu);
        return json(oeffentlich(neu, besitzer));
      }

      if (methode === "DELETE" && id) {
        const alt = await store.get(`${col}/${id}`, { type: "json" });
        if (!alt) return json({ ok: true });
        const eigen = def.eigeneLoeschen && alt.besitzer && alt.besitzer === besitzer;
        if (!(rolle === "kasse" || (eigen && darf(rolle, def.schreiben)))) {
          return fehler("Nur eigene Einträge können gelöscht werden", 403);
        }
        await store.delete(`${col}/${id}`);
        if (col === "fahrten") {
          // Mitfahrer dieser Fahrt mit entfernen
          for (const m of (await liste(store, "mitfahrer")).filter((x) => x.fahrtId === id)) await store.delete(`mitfahrer/${m.id}`);
        }
        return json({ ok: true });
      }
    }

    // ---------- Galerie ----------
    if (teile[0] === "galerie") {
      const id = teile[1];
      if (methode === "GET" && !id) {
        const alle = await liste(store, "galerie");
        const sichtbar = rolle === "kasse" ? alle : alle.filter((f) => !f.gemeldet);
        sichtbar.sort((a, b) => b.erstellt.localeCompare(a.erstellt));
        return json(sichtbar.map((f) => oeffentlich(f, besitzer)));
      }

      if (methode === "POST" && !id) {
        const form = await request.formData();
        const gross = form.get("gross");
        const klein = form.get("klein");
        const album = String(form.get("album") || "").trim().slice(0, 80) || "Allgemein";
        const name = String(form.get("name") || "").trim().slice(0, 60);
        const titel = String(form.get("titel") || "").trim().slice(0, 120);
        if (!(gross instanceof Blob) || !(klein instanceof Blob)) return fehler("Bild fehlt");
        if (gross.size > 3_000_000 || klein.size > 400_000) return fehler("Bild zu groß");
        const bGross = new Uint8Array(await gross.arrayBuffer());
        const bKlein = new Uint8Array(await klein.arrayBuffer());
        const istJpeg = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
        if (!istJpeg(bGross) || !istJpeg(bKlein)) return fehler("Nur JPEG-Bilder werden angenommen");
        const fid = neueId();
        const fs = fotos();
        await fs.set(`${fid}/gross`, bGross);
        await fs.set(`${fid}/klein`, bKlein);
        const meta = { id: fid, album, name, titel, besitzer, gemeldet: false, erstellt: new Date().toISOString() };
        await store.setJSON(`galerie/${fid}`, meta);
        return json(oeffentlich(meta, besitzer), 201);
      }

      if (id && teile[2] === "melden" && methode === "POST") {
        const meta = await store.get(`galerie/${id}`, { type: "json" });
        if (!meta) return fehler("Nicht gefunden", 404);
        const { grund } = await request.json().catch(() => ({}));
        await store.setJSON(`galerie/${id}`, { ...meta, gemeldet: true, meldegrund: String(grund || "").slice(0, 200) });
        return json({ ok: true });
      }

      if (id && teile[2] === "freigeben" && methode === "POST") {
        if (rolle !== "kasse") return fehler("Keine Berechtigung", 403);
        const meta = await store.get(`galerie/${id}`, { type: "json" });
        if (!meta) return fehler("Nicht gefunden", 404);
        await store.setJSON(`galerie/${id}`, { ...meta, gemeldet: false, meldegrund: "" });
        return json({ ok: true });
      }

      if (id && methode === "DELETE") {
        const meta = await store.get(`galerie/${id}`, { type: "json" });
        if (!meta) return json({ ok: true });
        if (!(rolle === "kasse" || (meta.besitzer && meta.besitzer === besitzer))) {
          return fehler("Nur eigene Fotos können gelöscht werden", 403);
        }
        const fs = fotos();
        await fs.delete(`${id}/gross`);
        await fs.delete(`${id}/klein`);
        await store.delete(`galerie/${id}`);
        return json({ ok: true });
      }
    }

    // Bilddaten ausliefern: /api/foto/:id/:groesse
    if (teile[0] === "foto" && methode === "GET" && teile[1] && ["gross", "klein"].includes(teile[2])) {
      const meta = await store.get(`galerie/${teile[1]}`, { type: "json" });
      if (!meta || (meta.gemeldet && rolle !== "kasse")) return fehler("Nicht gefunden", 404);
      const bild = await fotos().get(`${teile[1]}/${teile[2]}`, { type: "arrayBuffer" });
      if (!bild) return fehler("Nicht gefunden", 404);
      return new Response(bild, {
        headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" },
      });
    }

    return fehler("Unbekannte Anfrage", 404);
  } catch (e) {
    return fehler(e.message || "Fehler", 400);
  }
};

export const config = { path: "/api/*" };
