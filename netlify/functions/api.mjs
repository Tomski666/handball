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
      heim: { typ: "bool" }, halle: S(80), hinweis: S(300), artikelAnders: S(300), mengen: S(300) },
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
  vorrat: {
    // Schlüssel = Artikel (z. B. "kaffee"). Standdienst meldet nach dem Spiel den Stand.
    schreiben: "eltern", upsert: true,
    felder: { artikel: { ...S(40), pflicht: true }, status: { typ: "wahl", werte: ["ok", "knapp", "leer"], pflicht: true }, von: S(60), datum: { typ: "datum" } },
  },
  waesche: {
    // Schlüssel = Artikel. "bei" leer = liegt in der Kiste
    schreiben: "eltern", upsert: true,
    felder: { artikel: { ...S(40), pflicht: true }, bei: S(60), seit: { typ: "datum" } },
  },
  zeitnehmer: {
    schreiben: "eltern", eigeneLoeschen: true,
    felder: { spielId: { ...S(40), pflicht: true }, name: { ...S(60), pflicht: true } },
  },
  waschdienst: {
    // Pro Heimspiel: wer Geschirrtücher und Spüllappen nach dem Spiel mitnimmt, wäscht und zum nächsten Heimspiel mitbringt
    schreiben: "eltern", eigeneLoeschen: true,
    felder: { spielId: { ...S(40), pflicht: true }, name: { ...S(60), pflicht: true } },
  },
  hinweise: {
    // Infos vom Trainerteam, sichtbar bis zum angegebenen Datum
    schreiben: "trainer",
    felder: { text: { ...S(600), pflicht: true }, bis: { typ: "datum" }, von: S(60) },
  },
  abfragen: {
    // z. B. "Wer ist in den Herbstferien beim Training?"; optionen = Termine je Zeile, leer = nur ja/nein
    schreiben: "trainer",
    felder: { titel: { ...S(120), pflicht: true }, text: S(800), optionen: S(600), frist: { typ: "datum" }, geschlossen: { typ: "bool" }, von: S(60) },
  },
  abfrageAntworten: {
    // Schlüssel = Abfrage + Spieler. gewaehlt = gewählte Optionen (Zeilennummern, kommagetrennt) bzw. "ja"/"nein"
    schreiben: "eltern", upsert: true,
    felder: { abfrageId: { ...S(40), pflicht: true }, spieler: { ...S(30), pflicht: true }, gewaehlt: S(200), bemerkung: S(200), von: S(60) },
  },
  termine: {
    schreiben: "trainer",
    felder: { titel: { ...S(80), pflicht: true }, datum: { typ: "datum", pflicht: true }, zeit: { typ: "zeit" }, ort: S(120),
      beschreibung: S(2000), kostenProPerson: { typ: "zahl" }, frage: S(160), frist: { typ: "datum" } },
  },
  antworten: {
    // Schlüssel = Termin + Familie. Eltern melden sich zurück, die Kasse setzt "bezahlt".
    schreiben: "eltern", upsert: true, nurKasse: ["bezahlt"],
    felder: { terminId: { ...S(40), pflicht: true }, familie: { ...S(40), pflicht: true }, kommt: { typ: "bool" },
      personen: { typ: "zahl" }, bemerkung: S(160), bezahlt: { typ: "bool" }, von: S(60) },
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
  galerieAktiv: false,
  hallen: [], // { name, adresse } für Route-Links bei Spielen und Training
  namenZuordnung: {}, // Helfer-Übersicht: Name ohne Sohn in Klammern -> Vorname des Sohns oder "-" (nicht zählen)
  cateringArtikel: [
    { name: "Kuchen", bedarf: 2, hinweis: "1 Blech oder 1 großer Kuchen" },
    { name: "Muffins", bedarf: 2, hinweis: "ca. 12 Stück" },
    { name: "Laugengebäck", bedarf: 1, hinweis: "ca. 15 Stück" },
  ],
  vorratArtikel: [
    { name: "Kaffee", hinweis: "1 Packung gemahlen (500 g)" },
    { name: "Milch", hinweis: "1 Liter H-Milch" },
    { name: "Zucker", hinweis: "1 Packung" },
    { name: "Becher", hinweis: "1 Pack Pappbecher" },
    { name: "Spülmittel", hinweis: "1 Flasche" },
  ],
  waescheArtikel: ["Geschirrtücher", "Spüllappen"],
  zeitnehmerBei: "alle", // "alle" oder "heim"
  zeitnehmerPlaetze: 1,
  zeitnehmerHinweis: "Ohne Zeitnehmer droht eine Strafe für die Mannschaft.",
  standdienstVorlauf: 60, // Minuten vor Anpfiff
  standdienstInfo: "Die Jungs sind ebenfalls eine Stunde vor Anpfiff da. Aufgaben: Stand aufbauen, verkaufen und kassieren, am Ende abbauen.",
  kassenKategorien: ["Heimspiel-Catering", "Getränke OTV", "Einkauf Catering", "Mannschaftsfeier", "Geschenke", "Turnier/Fahrten", "Sonstiges"],
  kassenKanaele: ["Bar", "PayPal", "Überweisung", "Karte/SumUp"],
  widgetToken: "",
  handballNetUrl: "https://www.handball.net/team/95652?season_id=2627&phaseId=17411",
};

// Spielplan Saison 2026/27 (Regionsoberliga männliche C, Meisterrunde) und Kader nur mit Vornamen.
// Werden beim ersten Start angelegt bzw. per Datenstand-Abgleich ergänzt, ohne Bestehendes zu löschen.
const DATENSTAND = 8;

const WEIHNACHTSFEIER = {
  titel: "Weihnachtsfeier C-Jugend",
  datum: "2026-11-27",
  zeit: "17:00",
  ort: "Humboldthalle",
  beschreibung: "ab 17:00 Uhr: gemeinsames Training Spieler und Eltern mit Spiel und Spaß\nab ca. 19:00 Uhr: gemeinsames Pizzaessen und gemütliches Zusammensitzen bei einem Getränk\n\nDie Kosten für Spieler und Trainer werden aus der Vereinskasse übernommen. Alle anderen Teilnehmer (z. B. Eltern, Geschwister) zahlen 5 € pro Person. Die Pizza bestellen wir gemeinsam. Getränke bringen die Teilnehmer selbst mit (ausgenommen Spieler und Trainer).",
  kostenProPerson: 500,
  frage: "Wie viele zusätzliche Personen (Eltern, Geschwister) kommen mit?",
};

// Kassenbuch auf Papier bis 10.10.2026 (Anfangsbestand 812,08 € am 14.09.2026), einmalig übernommen
const KASSE_PAPIER = {
  anfangsbestand: 81208,
  anfangsdatum: "2026-09-14",
  buchungen: [
    { datum: "2026-09-18", art: "ausgabe", betrag: 11000, zweck: "Ausgaben Turnier 20.09.26", kategorie: "Turnier/Fahrten", kanal: "Bar", beleg: "Kassenbuch Papier ①" },
    { datum: "2026-09-18", art: "ausgabe", betrag: 520, zweck: "Ausgaben Turnier 20.09.26", kategorie: "Turnier/Fahrten", kanal: "Bar", beleg: "Kassenbuch Papier ②" },
    { datum: "2026-09-20", art: "einnahme", betrag: 32160, zweck: "Einnahmen Turnier 20.09.26", kategorie: "Turnier/Fahrten", kanal: "Bar", beleg: "Kassenbuch Papier" },
    { datum: "2026-09-20", art: "einnahme", betrag: 1250, zweck: "Spendenkasse", kategorie: "Sonstiges", kanal: "Bar", beleg: "Kassenbuch Papier" },
    { datum: "2026-09-25", art: "ausgabe", betrag: 10000, zweck: "Therabänder etc.", kategorie: "Sonstiges", kanal: "Bar", beleg: "Kassenbuch Papier ③" },
    { datum: "2026-09-25", art: "ausgabe", betrag: 10000, zweck: "Pinocchio Pizza", kategorie: "Mannschaftsfeier", kanal: "Bar", beleg: "Kassenbuch Papier ④" },
    { datum: "2026-10-10", art: "einnahme", betrag: 13050, zweck: "Heimspiel-Catering gegen Bergischer HC III", kategorie: "Heimspiel-Catering", kanal: "Bar", beleg: "Kassenbuch Papier", heimspiel: true },
  ],
};
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
  termine: [WEIHNACHTSFEIER],
  kader: [
    { vorname: "Christos", nummer: "", reihenfolge: 1 },
    { vorname: "Emil", nummer: "3", reihenfolge: 2 },
    { vorname: "Jasper", nummer: "", reihenfolge: 3 },
    { vorname: "Jonathan", nummer: "18", reihenfolge: 4 },
    { vorname: "Julian", nummer: "", reihenfolge: 5 },
    { vorname: "Lasse", nummer: "", reihenfolge: 6 },
    { vorname: "Levi H.", nummer: "", reihenfolge: 7 },
    { vorname: "Levi S.", nummer: "", reihenfolge: 8 },
    { vorname: "Liam", nummer: "", reihenfolge: 9 },
    { vorname: "Mats", nummer: "16", reihenfolge: 10 },
    { vorname: "Max", nummer: "", reihenfolge: 11 },
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
// Rollen: eltern < trainer < kasse. Trainer sehen alles wie Eltern und dürfen zusätzlich Hinweise und Abfragen anlegen.
const darf = (rolle, benoetigt) => rolle === "kasse" || (benoetigt === "eltern" && (rolle === "eltern" || rolle === "trainer")) || (benoetigt === "trainer" && rolle === "trainer");

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
  // Datenstand 8: Weihnachtsfeier anlegen (falls nicht vorhanden)
  if ((e.datenstand || 1) < 8) {
    const termine = await liste(store, "termine");
    if (!termine.some((t) => t.datum === WEIHNACHTSFEIER.datum)) {
      const id = "weihnachtsfeier-2026"; // feste Kennung, damit parallele Aufrufe keinen doppelten Termin anlegen
      await store.setJSON(`termine/${id}`, { id, ...WEIHNACHTSFEIER, erstellt: new Date().toISOString() });
    }
  }
  // Datenstand 7: Kader exakt auf die aktuelle Liste bringen (nicht mehr aufgeführte Spieler entfernen)
  if ((e.datenstand || 1) < 7) {
    const soll = new Set(STARTDATEN.kader.map((k) => norm(k.vorname)));
    for (const k of await liste(store, "kader")) {
      if (!soll.has(norm(k.vorname))) await store.delete(`kader/${k.id}`);
    }
  }
  for (const t of await liste(store, "trainer")) {
    if (t.rolle === "Trainerin" && t.name.startsWith("Marte")) await store.setJSON(`trainer/${t.id}`, { ...t, rolle: "Trainer" });
  }
  const neu = { ...e, datenstand: DATENSTAND };
  // Datenstand 8: Kaffee und Milch wandern von der Mitbringliste in den Vorrat
  if ((e.datenstand || 1) < 8) {
    const basis = neu.cateringArtikel || e.cateringArtikel;
    if (Array.isArray(basis)) neu.cateringArtikel = basis.filter((a) => !["Kaffee", "Milch"].includes(a.name));
  }
  // Datenstand 6: "Kinder" heißt jetzt "Jungs" (nur im unveränderten Standardtext)
  if ((e.datenstand || 1) < 6 && typeof e.standdienstInfo === "string") {
    neu.standdienstInfo = e.standdienstInfo.replace("Die Kinder sind", "Die Jungs sind");
  }
  // Datenstand 5: Papier-Kassenbuch übernehmen. Anfangsbestand nur, wenn noch der Platzhalter (850 € am 09.10.) steht;
  // Buchungen nur, wenn es keine gleiche Buchung (Datum, Art, Betrag) schon gibt.
  if ((e.datenstand || 1) < 5) {
    if ((e.anfangsbestand ?? 85000) === 85000 && (e.anfangsdatum ?? "2026-10-09") === "2026-10-09") {
      neu.anfangsbestand = KASSE_PAPIER.anfangsbestand;
      neu.anfangsdatum = KASSE_PAPIER.anfangsdatum;
    }
    const kasse = await liste(store, "kasse");
    const alleSpiele = await liste(store, "spiele");
    for (const b of KASSE_PAPIER.buchungen) {
      if (kasse.some((x) => x.datum === b.datum && x.art === b.art && x.betrag === b.betrag)) continue;
      const { heimspiel, ...daten } = b;
      const spiel = heimspiel ? alleSpiele.find((x) => x.datum === b.datum && x.heim) : null;
      const id = neueId();
      await store.setJSON(`kasse/${id}`, { id, ...daten, spielId: spiel?.id || "", erstellt: new Date().toISOString() });
    }
  }
  // Datenstand 4: Mengenhinweise für die Mitbringliste ergänzen, wo noch keine stehen
  if ((e.datenstand || 1) < 4 && Array.isArray(e.cateringArtikel)) {
    neu.cateringArtikel = e.cateringArtikel.map((a) => ({
      ...a, hinweis: a.hinweis ?? (STANDARD_EINSTELLUNGEN.cateringArtikel.find((x) => x.name === a.name)?.hinweis || ""),
    }));
  }
  // Datenstand 5: Kaffee nur bei Bedarf (wird pro Spiel zugeschaltet)
  if ((e.datenstand || 1) < 5) {
    const liste5 = neu.cateringArtikel || e.cateringArtikel;
    if (Array.isArray(liste5)) neu.cateringArtikel = liste5.map((a) => (a.name === "Kaffee" && a.immer === undefined ? { ...a, immer: false } : a));
  }
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
    else if (env("TRAINER_PASSWORT") && await passwordMatches(passwort, env("TRAINER_PASSWORT"))) rolle = "trainer";
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
      zusammen.galerieAktiv = zusammen.galerieAktiv === true;
      zusammen.zeitnehmerPlaetze = Math.min(3, Math.max(0, Number.parseInt(zusammen.zeitnehmerPlaetze, 10) || 0));
      zusammen.zeitnehmerBei = zusammen.zeitnehmerBei === "heim" ? "heim" : "alle";
      zusammen.standdienstVorlauf = Math.min(180, Math.max(0, Number.parseInt(zusammen.standdienstVorlauf, 10) || 0));
      zusammen.standdienstInfo = String(zusammen.standdienstInfo || "").slice(0, 400);
      const zo = zusammen.namenZuordnung && typeof zusammen.namenZuordnung === "object" && !Array.isArray(zusammen.namenZuordnung) ? zusammen.namenZuordnung : {};
      zusammen.namenZuordnung = Object.fromEntries(Object.entries(zo).filter(([k, v]) => typeof v === "string" && v && k.length <= 80).slice(0, 300).map(([k, v]) => [k.trim().toLowerCase(), v.slice(0, 40)]));
      zusammen.hallen = (Array.isArray(zusammen.hallen) ? zusammen.hallen : []).filter((h) => h && typeof h.name === "string" && h.name.trim())
        .slice(0, 40).map((h) => ({ name: String(h.name).trim().slice(0, 80), adresse: String(h.adresse || "").trim().slice(0, 160) }));
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
        if (rolle !== "kasse") for (const f of def.nurKasse || []) delete werte[f];
        if (col === "zeitnehmer") {
          const e = await einstellungen(store);
          const belegt = (await liste(store, "zeitnehmer")).filter((x) => x.spielId === werte.spielId).length;
          if (belegt >= (e.zeitnehmerPlaetze || 1)) return fehler("Für dieses Spiel gibt es schon einen Zeitnehmer", 409);
        }
        if (col === "waschdienst" && (await liste(store, "waschdienst")).some((x) => x.spielId === werte.spielId))
          return fehler("Für dieses Spiel nimmt schon jemand die Wäsche mit", 409);
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
        if (!/^[\w-]{1,100}$/.test(id)) return fehler("Ungültiger Schlüssel");
        const alt = await store.get(`${col}/${id}`, { type: "json" });
        if (!alt && !def.upsert) return fehler("Nicht gefunden", 404);
        if (alt && def.eigeneLoeschen && rolle !== "kasse" && alt.besitzer !== besitzer) {
          return fehler("Nur eigene Einträge können geändert werden", 403);
        }
        const werte = pruefe(def, await request.json(), true);
        if (rolle !== "kasse") for (const f of def.nurKasse || []) delete werte[f];
        const neu = { ...(alt || { id, erstellt: new Date().toISOString() }), ...werte, geaendert: new Date().toISOString() };
        await store.setJSON(`${col}/${id}`, neu);
        return json(oeffentlich(neu, besitzer));
      }

      if (methode === "DELETE" && id) {
        const alt = await store.get(`${col}/${id}`, { type: "json" });
        if (!alt) return json({ ok: true });
        const eigen = def.eigeneLoeschen && alt.besitzer && alt.besitzer === besitzer;
        if (!(rolle === "kasse" || (def.schreiben === "trainer" && rolle === "trainer") || (eigen && darf(rolle, def.schreiben)))) {
          return fehler("Nur eigene Einträge können gelöscht werden", 403);
        }
        await store.delete(`${col}/${id}`);
        if (col === "abfragen") {
          for (const x of (await liste(store, "abfrageAntworten")).filter((x) => x.abfrageId === id)) await store.delete(`abfrageAntworten/${x.id}`);
        }
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
        if (rolle !== "kasse" && !(await einstellungen(store)).galerieAktiv) return fehler("Die Galerie ist noch nicht freigegeben", 403);
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
