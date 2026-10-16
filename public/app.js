// Elternseite OTV männliche C-Jugend: Single-Page-App ohne Framework.

// ---------- Grundlagen ----------
const $ = (sel, el = document) => el.querySelector(sel);
const inhalt = $("#inhalt");
let Z = null; // Gesamtzustand vom Server
let galerie = [];
let galerieGeladen = false;
let albumFilter = "Alle";
let kassenFilter = "alle";
let kassenDetails = false;

function lokal(key, wert) {
  try {
    if (wert === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, wert);
  } catch { return null; }
}
// Kennung dieses Geräts, damit Eltern ihre eigenen Einträge wieder löschen können
let besitzer = lokal("otv_besitzer");
if (!besitzer) {
  besitzer = crypto.randomUUID();
  lokal("otv_besitzer", besitzer);
}
const gemerkterName = () => lokal("otv_name") || "";
const meinVorname = () => lokal("otv_vorname") || (lokal("otv_name") || "").split(" (")[0];
const meinKind = () => lokal("otv_kind") || "";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = (cent) => (cent / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const heute = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MO = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const datum = (iso) => new Date(iso + "T12:00:00");
const datumKurz = (iso) => datum(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const datumLang = (iso) => datum(iso).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });

async function api(methode, pfad, body) {
  const opts = { method: methode, headers: { "x-besitzer": besitzer } };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(pfad, opts);
  if (res.status === 401) {
    location.href = "/login.html?ziel=" + encodeURIComponent(location.pathname + location.hash);
    throw new Error("Nicht angemeldet");
  }
  const daten = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(daten.fehler || "Fehler " + res.status);
  return daten;
}

function meldung(text, istFehler = false) {
  const t = document.createElement("div");
  t.className = "toast" + (istFehler ? " fehler" : "");
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), istFehler ? 5000 : 2500);
}

async function laden() {
  Z = await api("GET", "/api/zustand");
  document.body.classList.toggle("rolle-kasse", Z.rolle === "kasse");
}

// ---------- abgeleitete Daten ----------
const spieleSortiert = () => [...Z.spiele].sort((a, b) => (a.datum + a.zeit).localeCompare(b.datum + b.zeit));
const heimspiele = () => spieleSortiert().filter((s) => s.heim);
const kommende = (liste) => liste.filter((s) => s.datum >= heute());
const vergangene = (liste) => liste.filter((s) => s.datum < heute());
const kader = () => [...Z.kader].sort((a, b) => (a.reihenfolge - b.reihenfolge) || a.vorname.localeCompare(b.vorname, "de"));
const familien = () => kader().map((k) => "Familie von " + k.vorname);
const istAdmin = () => Z.rolle === "kasse";
const istTrainer = () => Z.rolle === "trainer" || Z.rolle === "kasse";
const darfLoeschen = (e) => istAdmin() || e.eigen;

function trikotPlan() {
  const fam = familien();
  return spieleSortiert().map((s, i) => {
    const eintrag = Z.trikots.find((t) => t.id === s.id) || {};
    return {
      spiel: s,
      familie: eintrag.familie || (fam.length ? fam[i % fam.length] : "–"),
      getauscht: !!eintrag.familie,
      erledigt: !!eintrag.erledigt,
    };
  });
}

function kassenBuchungen() {
  return [...Z.kasse].sort((a, b) => (a.datum + a.erstellt).localeCompare(b.datum + b.erstellt));
}
function kassenSummen() {
  const b = kassenBuchungen();
  const ein = b.filter((x) => x.art === "einnahme").reduce((s, x) => s + x.betrag, 0);
  const aus = b.filter((x) => x.art === "ausgabe").reduce((s, x) => s + x.betrag, 0);
  return { ein, aus, saldo: Z.einstellungen.anfangsbestand + ein - aus };
}

function spielName(id) {
  const s = Z.spiele.find((x) => x.id === id);
  return s ? `${datumKurz(s.datum)} gegen ${s.gegner}` : "";
}

function datumBlock(iso) {
  const d = datum(iso);
  return `<div class="datum-block"><div class="wt">${WT[d.getDay()]}</div><div class="tg">${d.getDate()}</div><div class="mo">${MO[d.getMonth()]}</div></div>`;
}
function spielZeile(s) {
  return `<div class="spiel">${datumBlock(s.datum)}<div>
    <div class="spiel-titel">${s.heim ? "OTV gegen " + esc(s.gegner) : esc(s.gegner) + " gegen OTV"}</div>
    <div class="leise">${s.zeit ? esc(s.zeit) + " Uhr · " : ""}${esc(s.halle || "Halle folgt")}
      <span class="${s.heim ? "marke-heim" : "marke-aus"}">${s.heim ? "Heim" : "Auswärts"}</span></div>
    ${s.hinweis ? `<div class="klein">${esc(s.hinweis)}</div>` : ""}
  </div></div>`;
}
// Uhrzeit, zu der der Standdienst da sein soll (Anpfiff minus Vorlauf)
function treffzeit(s) {
  if (!s.zeit) return "";
  const [h, m] = s.zeit.split(":").map(Number);
  const min = Math.max(0, h * 60 + m - (Z.einstellungen.standdienstVorlauf ?? 60));
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
// grober Vorschlag: 45 Minuten Fahrt vor der Treffzeit
function abfahrtVorschlag(s) {
  const t = treffzeit(s);
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const min = Math.max(0, h * 60 + m - 45);
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
// Hallen mit Adresse (Verwaltung) und Route-Link zu Google Maps (öffnet auf dem Handy die Karten-App)
function halleZu(name) {
  const n = (name || "").trim().toLowerCase();
  if (!n) return null;
  const hallen = Z.einstellungen.hallen || [];
  return hallen.find((h) => h.name.toLowerCase() === n) || hallen.find((h) => n.includes(h.name.toLowerCase()) || h.name.toLowerCase().includes(n)) || null;
}
function routeLink(name, klasse = "knopf klein zweit") {
  const h = halleZu(name);
  const ziel = h && h.adresse ? h.adresse : "";
  return ziel ? `<a class="${klasse}" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ziel)}" target="_blank" rel="noopener">Route</a>` : "";
}
const halleAdresse = (name) => halleZu(name)?.adresse || "";

function hallenZeile(s) {
  const t = treffzeit(s);
  return `<p class="info-zeile">${t ? `Die Jungs müssen spätestens um <strong>${t} Uhr</strong> in der Halle sein` : `Die Jungs müssen ${Z.einstellungen.standdienstVorlauf ?? 60} Minuten vor Anwurf in der Halle sein`} (${Z.einstellungen.standdienstVorlauf ?? 60} Minuten vor Anwurf). Abfahrt bitte entsprechend früher planen.</p>`;
}
const AUSTRAGEN_HINWEIS = "Austragen geht nur auf dem Handy, mit dem du dich eingetragen hast. Sonst kurz in die WhatsApp-Gruppe schreiben.";
const kopfzeile = (unter, titel) => `<p class="unterzeile">${unter}</p><h1>${titel}</h1>`;

// ---------- Seiten ----------
const SEITEN = {
  "": seiteStart,
  mannschaft: seiteMannschaft,
  spiele: seiteSpiele,
  catering: seiteCatering,
  fahrten: seiteFahrten,
  termine: seiteInfos,
  infos: seiteInfos,
  trikots: seiteTrikots,
  kasse: seiteKasse,
  galerie: seiteGalerie,
  verwaltung: seiteVerwaltung,
  datenschutz: seiteDatenschutz,
};

function meineTermine() {
  const t = [];
  const spiel = (id) => Z.spiele.find((x) => x.id === id);
  const kommt = (sp) => sp && sp.datum >= heute();
  for (const d of Z.standdienst.filter((x) => x.eigen)) {
    const sp = spiel(d.spielId);
    if (kommt(sp)) t.push({ key: "s" + d.id, spiel: sp, text: d.reserve ? "Du bist Reserve beim Standdienst" : `Du hast Standdienst${d.nachgerueckt ? " (nachgerückt)" : ""}${treffzeit(sp) ? `, ab ${treffzeit(sp)} Uhr` : ""}`, standdienst: true, link: "#/catering" });
  }
  for (const c of Z.catering.filter((x) => x.eigen)) {
    const sp = spiel(c.spielId);
    if (kommt(sp)) t.push({ key: "c" + c.id, spiel: sp, text: `Du bringst ${c.artikel} mit${c.menge ? ` (${c.menge})` : ""}`, link: "#/catering" });
  }
  for (const f of Z.fahrten.filter((x) => x.eigen)) {
    const sp = spiel(f.spielId);
    const mit = Z.mitfahrer.filter((m) => m.fahrtId === f.id).map((m) => m.name);
    if (kommt(sp)) t.push({ key: "f" + f.id, spiel: sp, text: `Du fährst${mit.length ? ": " + mit.join(", ") : ""}${f.treffpunkt ? " · " + f.treffpunkt : ""}${treffzeit(sp) ? ` · in der Halle um ${treffzeit(sp)}` : ""}`, standdienst: true, link: "#/fahrten" });
  }
  for (const m of Z.mitfahrer.filter((x) => x.eigen)) {
    const f = Z.fahrten.find((x) => x.id === m.fahrtId);
    const sp = f && spiel(f.spielId);
    if (kommt(sp)) t.push({ key: "m" + m.id, spiel: sp, text: `${m.name} fährt mit bei ${anzeigeName(f.fahrer)}${f.treffpunkt ? " · " + f.treffpunkt : ""}`, standdienst: true, link: "#/fahrten" });
  }
  for (const w of (Z.waschdienst || []).filter((x) => x.eigen)) {
    const sp = spiel(w.spielId);
    if (!sp) continue;
    if (kommt(sp)) t.push({ key: "w" + w.id, spiel: sp, text: `Du nimmst nach dem Spiel ${waescheText()} mit`, standdienst: true, link: "#/catering" });
    else {
      const naechstes = kommende(heimspiele()).find((x) => x.datum > sp.datum);
      if (naechstes) t.push({ key: "wz" + w.id, spiel: naechstes, text: `Bitte ${waescheText()} gewaschen mitbringen`, standdienst: true, link: "#/catering" });
    }
  }
  for (const z of (Z.zeitnehmer || []).filter((x) => x.eigen)) {
    const sp = spiel(z.spielId);
    if (kommt(sp)) t.push({ key: "z" + z.id, spiel: sp, text: "Du bist Zeitnehmer", standdienst: true, link: "#/spiele" });
  }
  if (meinKind()) {
    for (const a of (Z.antworten || []).filter((x) => x.familie === meinKind() && x.kommt)) {
      const tm = (Z.termine || []).find((x) => x.id === a.terminId);
      if (tm && tm.datum >= heute()) t.push({ key: "a" + a.id, spiel: { datum: tm.datum, zeit: tm.zeit, titel: tm.titel, ort: tm.ort }, text: `${tm.titel}${a.personen ? ` (+${a.personen})` : ""}`, link: "#/infos" });
    }
  }
  if (meinKind()) {
    for (const p of trikotPlan().filter((p) => !p.erledigt && p.spiel.datum >= heute() && p.familie === "Familie von " + meinKind())) {
      t.push({ key: "t" + p.spiel.id, spiel: p.spiel, text: "Ihr nehmt die Trikots zum Waschen mit", link: "#/trikots" });
    }
  }
  return t.sort((a, b) => (a.spiel.datum + a.spiel.zeit).localeCompare(b.spiel.datum + b.spiel.zeit));
}

function kalenderLaden(termine) {
  if (!termine.length) return;
  const f = (d) => d.replace(/-/g, "");
  const z = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OTV C-Jugend//DE", "CALSCALE:GREGORIAN"];
  for (const t of termine) {
    const s = t.spiel;
    const titel = t.titel || (s.titel ? t.text : `${t.text.split(" · ")[0]}: ${s.heim ? "OTV gegen " + s.gegner : s.gegner + " gegen OTV"}`);
    z.push("BEGIN:VEVENT", `UID:${t.key}@otv-c-jugend`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`);
    if (s.zeit) {
      const start = t.standdienst && treffzeit(s) ? treffzeit(s) : s.zeit;
      const [h, m] = start.split(":").map(Number);
      const ende = `${String(Math.min(23, h + 2)).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
      z.push(`DTSTART:${f(s.datum)}T${start.replace(":", "")}00`, `DTEND:${f(s.datum)}T${ende}`);
    } else {
      z.push(`DTSTART;VALUE=DATE:${f(s.datum)}`);
    }
    z.push(`SUMMARY:${titel.replace(/[,;]/g, "\\$&")}`);
    const ort = s.halle ? [s.halle, halleAdresse(s.halle)].filter(Boolean).join(", ") : s.ort;
    if (ort) z.push(`LOCATION:${ort.replace(/[,;]/g, "\\$&")}`);
    z.push(`DESCRIPTION:${(t.text + "\\n" + location.origin + "/" + t.link).replace(/[,;]/g, "\\$&")}`);
    z.push("BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:Erinnerung OTV C-Jugend", "END:VALARM", "END:VEVENT");
  }
  z.push("END:VCALENDAR");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([z.join("\r\n")], { type: "text/calendar;charset=utf-8" }));
  a.download = termine.length === 1 ? "OTV-Termin.ics" : "OTV-Termine.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  meldung("Kalenderdatei geladen, bitte öffnen und hinzufügen");
}

const wochentagLang = (s) => datum(s.datum).toLocaleDateString("de-DE", { weekday: "long" });
const istBald = (s) => (datum(s.datum) - datum(heute())) / 864e5 < 7;

// Eine Zeile in der Aufgabenliste: Status-Punkt, Titel, Stand, Details, Knopf
function aufgabe({ status = "offen", titel, stand = "", detail = "", knopf = "" }) {
  return `<li class="aufgabe st-${status}"><span class="punkt" aria-hidden="true"></span>
    <div class="aufgabe-text"><div><strong>${titel}</strong>${stand ? ` <span class="aufgabe-stand">${stand}</span>` : ""}</div>${detail ? `<div class="aufgabe-detail">${detail}</div>` : ""}</div>
    ${knopf ? `<div class="aufgabe-knopf">${knopf}</div>` : ""}</li>`;
}
// Name mit Sohn anzeigen. Fehlt der Sohn im Eintrag, hilft die Zuordnung aus der Verwaltung.
// Angezeigt wird nur der Vorname (Datensparsamkeit), auch wenn jemand den Nachnamen mit eingetragen hat.
function anzeigeName(name) {
  const n = (name || "").trim();
  const f = (Z.einstellungen.namenZuordnung || {})[n.toLowerCase()];
  const klammer = /\(([^()]+)\)\s*$/.exec(n);
  const basis = n.replace(/\s*\([^()]+\)\s*$/, "").split(/\s+/)[0] || n;
  const sohn = f && f !== "-" ? f : klammer ? klammer[1].trim() : "";
  return sohn ? `${basis} (${sohn})` : basis;
}
const wer = (liste) => liste.map((x) => `${esc(anzeigeName(x.name))}${x.eigen ? " · du" : ""}`).join(", ");
const offenZaehler = (html) => (html.match(/st-(offen|dringend)/g) || []).length;
function statusPill(n) {
  return n ? `<span class="pill offen">${n} ${n === 1 ? "Aufgabe" : "Aufgaben"} offen</span>` : `<span class="pill ok">✓ Alles besetzt</span>`;
}


function uebernaechstesHinweis(heim, schonGezeigt = []) {
  if (!cateringStatus(heim).komplett) return "";
  const naechste = kommende(heimspiele()).filter((s) => s.id !== heim.id && !schonGezeigt.includes(s.id)).find((s) => !cateringStatus(s).komplett);
  if (!naechste) return "";
  const st = cateringStatus(naechste);
  const frei = st.plaetze - st.dienst;
  const mitbringen = st.offen.length === st.artikel.length ? ["die ganze Mitbringliste"] : st.offen.map((a) => a.name);
  const teile = [frei > 0 ? `${frei}× Standdienst` : "", ...mitbringen].filter(Boolean);
  return `<p class="danach"><a href="#/catering" data-aktion="springen-catering" data-id="${naechste.id}">Am ${datum(naechste.datum).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" })} gegen ${esc(naechste.gegner)} fehlen auch noch ${esc(teile.join(", "))} ›</a></p>`;
}

// ---------- Eine Spielkarte für Startseite und Spiele-Seite ----------
function heimAufgaben(s) {
  const st = cateringStatus(s);
  const dienst = Z.standdienst.filter((x) => x.spielId === s.id && !x.reserve);
  const ichDienst = dienst.some((x) => x.eigen);
  const frei = st.plaetze - st.dienst;
  const bald = (datum(s.datum) - datum(heute())) / 864e5 <= 3;
  const z = [{
    status: frei > 0 ? (bald ? "dringend" : "offen") : "ok", titel: "Standdienst", kurz: "Standdienst",
    stand: `${st.dienst} von ${st.plaetze}${frei > 0 && bald ? " · dringend" : ""}`,
    detail: [dienst.length ? wer(dienst) : "", treffzeit(s) ? `ab ${treffzeit(s)} Uhr in der Halle` : ""].filter(Boolean).join(" · "),
    knopf: frei > 0 && !ichDienst ? `<button class="knopf klein" data-aktion="standdienst-ich" data-spiel="${s.id}">Ich übernehme</button>` : "",
  }];
  if (st.artikel.length) {
    const ok = st.artikel.filter((a) => a.zugesagt >= a.bedarf).length;
    const offen = st.artikel.filter((a) => a.zugesagt < a.bedarf);
    z.push({
      status: offen.length ? "offen" : "ok", titel: "Mitbringen", kurz: "Mitbringen",
      stand: `${ok} von ${st.artikel.length}`,
      detail: st.artikel.map((a) => `${esc(a.name)} <span class="${a.zugesagt >= a.bedarf ? "gut-text" : "offen-text"}">${a.zugesagt}/${a.bedarf}</span>`).join(" · "),
      knopf: offen.length ? `<button class="knopf klein zweit" data-aktion="mitbringen-liste" data-ziel="mb-${s.id}" aria-expanded="false">Ich bringe mit</button>` : "",
    });
  }
  return z;
}
function auswAufgaben(s) {
  const st = fahrtStatus(s);
  const kind = meinKind();
  const kindDabei = kind && Z.mitfahrer.some((m) => m.name === kind && st.fahrten.some((f) => f.id === m.fahrtId));
  const ichFahre = st.fahrten.some((f) => f.eigen);
  const v = Z.einstellungen.standdienstVorlauf ?? 60;
  const z = [{
    status: "info", titel: "Treffen in der Halle",
    stand: treffzeit(s) ? `${treffzeit(s)} Uhr` : `${v} Min. vor Anwurf`,
    detail: `${s.halle ? esc(s.halle) + (halleAdresse(s.halle) && !s.halle.includes(halleAdresse(s.halle)) ? ", " + esc(halleAdresse(s.halle)) : "") : "Halle folgt"}`,
    knopf: routeLink(s.halle),
  }];
  if (!st.fahrten.length) {
    z.push({ status: "offen", titel: "Fahrgemeinschaft", kurz: "Fahrer", stand: "noch kein Fahrer",
      knopf: `<button class="knopf klein" data-aktion="fahrt-anbieten" data-id="${s.id}">Ich fahre</button>` });
  }
  for (const f of st.fahrten) {
    const mit = Z.mitfahrer.filter((m) => m.fahrtId === f.id).map((m) => m.name);
    const frei = f.plaetze - mit.length;
    z.push({
      status: frei > 0 ? "ok" : "info",
      titel: `${esc(anzeigeName(f.fahrer))} fährt${f.eigen ? " · du" : ""}`,
      stand: frei > 0 ? `${frei} frei` : "voll",
      detail: [f.treffpunkt ? "Abfahrt " + esc(abfahrtText(f.treffpunkt)) : "", mit.length ? "dabei: " + esc(mit.join(", ")) : "noch niemand dabei"].filter(Boolean).join(" · "),
      knopf: frei > 0 && kind && !kindDabei ? `<button class="knopf klein" data-aktion="mitfahren-schnell" data-fahrt="${f.id}">${esc(kind)} fährt mit</button>` : "",
    });
  }
  if (st.fahrten.length && !ichFahre) {
    z.push({ status: "info", titel: "Weitere Fahrer willkommen",
      knopf: `<button class="knopf klein zweit" data-aktion="fahrt-anbieten" data-id="${s.id}">Ich fahre auch</button>` });
  }
  return z;
}
function spielKarte(s, { start = false, schonGezeigt = [] } = {}) {
  const zeilen = [...(s.heim ? heimAufgaben(s) : auswAufgaben(s)), zeitnehmerAufgabe(s), s.heim ? waescheAufgabe(s) : null, trikotAufgabe(s)].filter(Boolean);
  const offen = zeilen.filter((z) => z.status === "offen" || z.status === "dringend");
  const status = offen.length
    ? `<span class="pill ${offen.some((z) => z.status === "dringend") ? "dringend" : "offen"}">${offen.length <= 3 ? "Offen: " + offen.map((z) => z.kurz || z.titel).join(", ") : `${offen.length} Aufgaben offen`}</span>`
    : `<span class="pill ok">✓ Alles besetzt</span>`;
  const st = s.heim ? cateringStatus(s) : null;
  const auswahl = s.heim && st.offen.length ? `<div class="mitbringen-auswahl" id="mb-${s.id}" hidden>
      <p class="leise klein" style="margin:4px 0 6px">Was bringst du mit? Einmal antippen genügt.</p>
      <div class="hero-knoepfe">${st.offen.map((a) => `<button class="knopf zweit gross" data-aktion="bringe-schnell" data-spiel="${s.id}" data-artikel="${esc(a.name)}">${esc(a.name)}${a.hinweis ? `<small>je ${esc(a.hinweis)}</small>` : ""}</button>`).join("")}</div></div>` : "";
  const offenGesetzt = start || (offeneSpiele && offeneSpiele.has(s.id));
  return `<details class="karte spiel-karte spielkarte ${s.heim ? "" : "aus"}" data-spiel="${s.id}" id="spiel-${s.id}" ${offenGesetzt ? "open" : ""}>
    <summary>${start ? `<span class="kachel-label">${s.heim ? "Nächstes Heimspiel" : "Nächstes Auswärtsspiel"}</span>` : ""}
      <div class="summary-innen">${spielZeile(s)}<div class="summary-status">${status}</div></div></summary>
    <div class="spielkarte-inhalt">
      <ul class="aufgaben">${zeilen.map(aufgabe).join("")}</ul>
      ${auswahl}
      <details class="mehr-details" id="mehr-${s.id}"><summary>${s.heim ? "Standdienst, Reserve und Mitbringliste im Detail" : "Fahrten im Detail: mitfahren, Plätze anbieten"}</summary>
        <div class="abstand">${s.heim ? cateringDetails(s) : fahrtenDetails(s)}</div></details>
      ${istTrainer() || istAdmin() ? `<div class="spielkarte-fuss">
        ${istTrainer() ? `<button class="knopf klein zweit" data-aktion="whatsapp-spiel" data-spiel="${s.id}">Für WhatsApp kopieren</button>` : "<span></span>"}
        ${istAdmin() ? `<span class="ausrichten"><button class="link-knopf" data-aktion="spiel-bearbeiten" data-id="${s.id}">Spiel bearbeiten</button>
          <button class="link-knopf gefahr-text" data-aktion="loeschen" data-col="spiele" data-id="${s.id}" data-frage="Spiel löschen? Einträge zu diesem Spiel bleiben erhalten, werden aber nicht mehr angezeigt.">löschen</button></span>` : ""}
      </div>` : ""}
      ${start && s.heim ? uebernaechstesHinweis(s, schonGezeigt) : ""}
    </div>
  </details>`;
}
const heimKarte = (s, schonGezeigt) => spielKarte(s, { start: true, schonGezeigt });
const auswaertsKarte = (s) => spielKarte(s, { start: true });

function seiteStart() {
  const zwei = kommende(spieleSortiert()).slice(0, 2);
  const gezeigt = zwei.map((s) => s.id);
  const karten = zwei.map((s) => (s.heim ? heimKarte(s, gezeigt) : auswaertsKarte(s)));
  // Ist unter den zwei Spielen kein Heimspiel, das nächste Heimspiel kurz erwähnen
  const naechstesHeim = kommende(heimspiele())[0];
  const heimHinweis = naechstesHeim && !zwei.some((s) => s.heim) && !cateringStatus(naechstesHeim).komplett
    ? `<p class="danach"><a href="#/catering" data-aktion="springen-catering" data-id="${naechstesHeim.id}">Nächstes Heimspiel am ${datum(naechstesHeim.datum).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" })}: Catering eintragen ›</a></p>` : "";

  const termine = meineTermine();
  const aufgabeLi = (t) => `<li><a class="meine-aufgabe" href="${t.link}"><span class="ma-datum">${wochentagKurz(t.spiel.datum)} ${kurzDatum(t.spiel.datum)}</span>
      <span class="ma-text"><strong>${esc(t.text)}</strong><span class="leise klein">${t.spiel.titel ? esc(t.spiel.ort || "") : (t.spiel.heim ? "gegen " : "bei ") + esc(t.spiel.gegner)}</span></span></a>
    <button class="link-knopf klein" data-aktion="kalender" data-key="${t.key}" aria-label="In den Kalender">Kalender</button></li>`;
  const meine = termine.length ? `<section class="karte deine-aufgaben">
    <div class="karte-kopf"><h2 style="margin:0">Deine Aufgaben</h2>
      ${termine.length > 1 ? `<button class="link-knopf klein" data-aktion="kalender" data-alle="1">Alle in den Kalender</button>` : ""}</div>
    <ul class="liste">${termine.slice(0, 4).map(aufgabeLi).join("")}</ul>
    ${termine.length > 4 ? `<details><summary class="klein">Alle anzeigen (${termine.length})</summary><ul class="liste">${termine.slice(4).map(aufgabeLi).join("")}</ul></details>` : ""}
  </section>` : "";

  const terminHinweis = offeneRueckmeldungen().filter((x) => !x.meins).map((x) => `<a class="termin-hinweis ${fristBald(x.frist) ? "dringend" : ""}" href="#/infos"><span><strong>${esc(x.titel)}</strong>${x.datum ? ` am ${kurzDatum(x.datum)}` : ""}: bitte ${meinKind() ? `für ${esc(meinKind())} ` : ""}${x.art === "termin" ? "zurückmelden" : "antworten"}${x.frist && x.frist >= heute() ? ` <span class="frist-text">bis ${wochentagKurz(x.frist)} ${kurzDatum(x.frist)}</span>` : ""}</span> ›</a>`).join("");

  const infos = aktiveHinweise().length ? `<section class="karte infos-start"><div class="karte-kopf"><h2 style="margin:0">Vom Trainerteam</h2><a class="klein" href="#/infos">alle ›</a></div>${hinweiseKarte(true)}</section>` : "";
  return `<p class="unterzeile">${meinVorname() ? "Hallo " + esc(meinVorname()) : "Willkommen"}</p><h1>Die nächsten Spiele</h1>
  ${installKarte()}
  ${!meinKind() && Z.rolle !== "trainer" ? `<section class="karte sohn-fehlt"><div><strong>Wer ist dein Sohn?</strong>
      <div class="leise klein">Einmal auswählen, dann sind deine Einträge eurer Familie zugeordnet und du kannst bei Terminen und Abfragen antworten.</div></div>
      <button class="knopf klein" data-aktion="name-aendern">Jetzt auswählen</button></section>` : ""}
  ${infos}
  ${meine}
  ${terminHinweis}
  ${karten.length ? karten.map((k, i) => `<div class="${i ? "abstand" : ""}">${k}</div>`).join("") : `<section class="karte"><p class="leer">Gerade steht kein Spiel an.</p></section>`}
  ${heimHinweis}`;
}

function seiteMannschaft() {
  const e = Z.einstellungen;
  const trainer = [...Z.trainer].sort((a, b) => a.reihenfolge - b.reihenfolge);
  const init = (n) => n.split(" ").map((t) => t[0]).join("").slice(0, 2).toUpperCase();
  return `${kopfzeile("Über uns", "Die Mannschaft")}
  <div class="raster-2">
    <section class="karte">
      <h2>Wer wir sind</h2>
      ${e.teamText.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("")}
      <p class="leise">Liga: ${esc(e.liga)}</p>
    </section>
    <section class="karte">
      <h2>Trainingszeiten</h2>
      <ul class="liste">${e.trainingszeiten.map((t) => `<li><div><strong>${esc(t.tag)}</strong><div class="leise">${esc(t.zeit)}</div></div>
        <div class="training-halle"><div>${esc(t.halle)}</div>${halleAdresse(t.halle) ? `<div class="leise klein">${esc(halleAdresse(t.halle))}</div>` : ""}${routeLink(t.halle, "link-knopf")}</div></li>`).join("")}</ul>
    </section>
  </div>
  <section class="karte abstand">
    <h2>Kader</h2>
    ${kader().length ? `<div class="kader">${kader().map((k) => `<span class="spieler">${k.nummer ? `<small>#${esc(k.nummer)}</small>` : ""}${esc(k.vorname)}</span>`).join("")}</div>`
      : `<p class="leer">Kader wird noch eingetragen.</p>`}
    <p class="leise abstand" style="margin-bottom:0">Wir nennen Spieler hier bewusst nur mit Vornamen.</p>
  </section>
  <p class="unterzeile abstand">Trainerteam</p>
  <div class="raster abstand" style="margin-top:8px">
    ${trainer.map((t) => `<section class="karte">
      <div class="trainer-kopf"><div class="initialen">${esc(init(t.name))}</div><div><h3 style="margin:0">${esc(t.name)}</h3><div class="leise">${esc(t.rolle)}</div></div></div>
      ${t.text ? t.text.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("") : `<p class="leer">Text folgt.</p>`}
    </section>`).join("")}
  </div>`;
}

// ---------- Kalender-Abo ----------
let kalenderPfad = null;
function kalenderAboKarte() {
  if (kalenderPfad === null) {
    kalenderPfad = "";
    api("GET", "/api/kalender-link").then((r) => { kalenderPfad = r.pfad; if (location.hash.startsWith("#/spiele")) zeigen(); }).catch(() => { kalenderPfad = null; });
  }
  const https = kalenderPfad ? location.origin + kalenderPfad : "";
  const webcal = kalenderPfad ? "webcal://" + location.host + kalenderPfad : "";
  const android = /Android/i.test(navigator.userAgent);
  return `<details class="karte kalender-abo formular-klappe"><summary>Spiele und Termine im Handy-Kalender</summary>
    <p class="abstand">Einmal abonnieren, dann stehen alle Spiele automatisch in deinem Kalender und bleiben aktuell, auch wenn sich eine Anwurfzeit oder Halle ändert.</p>
    <p class="hinweis info" style="margin-bottom:12px"><strong>Gut zu wissen:</strong> Im Abo stehen nicht nur die Spiele, sondern auch andere Termine der Mannschaft, zum Beispiel Weihnachtsfeier oder Elternabend. Namen oder Einträge von Eltern stehen nicht darin.</p>
    ${kalenderPfad ? `<div class="ausrichten">
      ${android ? "" : `<a class="knopf" href="${webcal}">Kalender abonnieren</a>`}
      <button class="knopf ${android ? "" : "zweit"}" data-aktion="kalender-link-kopieren" data-link="${https}">Link kopieren</button>
    </div>
    <details class="abstand"><summary>${android ? "So geht es mit Android und Google Kalender" : "Android oder Google Kalender? So geht es"}</summary>
      <ol class="schritte abstand">
        <li>Oben auf <strong>„Link kopieren“</strong> tippen.</li>
        <li>Im Browser <strong>calendar.google.com</strong> öffnen (am besten am PC, in der Handy-App geht es leider nicht).</li>
        <li>Links bei „Weitere Kalender“ auf <strong>+</strong> und dann <strong>„Per URL“</strong>.</li>
        <li>Link einfügen und <strong>„Kalender hinzufügen“</strong>. Nach kurzer Zeit erscheint er auch in der App auf dem Handy.</li>
      </ol>
      <p class="leise klein">Google Kalender aktualisiert Abos nur alle paar Stunden. Kurzfristige Änderungen am Spieltag kommen weiter über WhatsApp.</p>
    </details>
    <p class="leise klein abstand">Den Link bitte nur innerhalb der Mannschaft weitergeben. ${kommende(spieleSortiert()).length ? `<button class="link-knopf" data-aktion="kalender-spiele">Spiele stattdessen einmalig als Datei laden</button>` : ""}</p>`
      : `<p class="leise">Link wird geladen …</p>`}
  </details>`;
}

let spieleFilter = "alle";
function seiteSpiele() {
  const e = Z.einstellungen;
  const alle = spieleSortiert();
  const f = spieleFilter;
  const liste = alle.filter((s) => f === "alle" || (f === "heim" ? s.heim : !s.heim));
  const k = kommende(liste), v = vergangene(liste);
  if (offeneSpiele === null) offeneSpiele = new Set(k.length ? [k[0].id] : []);
  const knopf = (wert, text) => `<button class="seg ${f === wert ? "an ok" : ""}" data-aktion="spiele-filter" data-wert="${wert}">${text}</button>`;
  return `${kopfzeile("Standdienst, Mitbringen, Fahrten, Zeitnehmer", "Spiele")}
  <div class="spiele-kopf">
    <div class="segment filter">${knopf("alle", "Alle")}${knopf("heim", "Heimspiele")}${knopf("aus", "Auswärts")}</div>
  </div>
  <p class="leise klein">Spiel antippen, um alle Aufgaben zu sehen. ${AUSTRAGEN_HINWEIS}</p>
  ${k.length ? k.map((s) => spielKarte(s)).join("") : `<section class="karte"><p class="leer">Keine kommenden Spiele${f === "heim" ? " (Heim)" : f === "aus" ? " (Auswärts)" : ""} eingetragen.</p></section>`}
  ${v.length ? `<details class="abstand"><summary>Vergangene Spiele (${v.length})</summary><div class="abstand">${[...v].reverse().map((s) => spielKarte(s)).join("")}</div></details>` : ""}
  <h2 class="bereich-titel">Rund um die Spiele</h2>
  ${f !== "aus" ? vorratKarte() : ""}
  ${kalenderAboKarte()}
  <details class="karte formular-klappe"><summary>Spielplan und Tabelle (handball.net)</summary>
    <div class="abstand">${e.widgetToken ? `<div id="handball-spielplan"></div><div id="handball-tabelle" class="abstand"></div>` : `<p>Spielplan, Ergebnisse und Tabelle kommen direkt von handball.net.</p>`}
    <a class="knopf zweit" href="${esc(e.handballNetUrl)}" target="_blank" rel="noopener">Auf handball.net öffnen</a></div>
  </details>
  <details class="karte formular-klappe nur-kasse" id="spiel-formular"><summary id="spiel-titel">Spiel hinzufügen</summary>
    <form class="zeile abstand" data-form="spiel">
      <input type="hidden" name="id">
      <div class="feld"><label>Datum</label><input type="date" name="datum" required></div>
      <div class="feld" style="flex-basis:110px"><label>Anwurf</label><input type="time" name="zeit"></div>
      <div class="feld"><label>Gegner</label><input type="text" name="gegner" required maxlength="80"></div>
      <div class="feld"><label>Halle</label><input type="text" name="halle" maxlength="80" list="hallen-liste"><datalist id="hallen-liste">${(e.hallen || []).map((h) => `<option value="${esc(h.name)}">`).join("")}</datalist></div>
      <div class="feld" style="flex-basis:130px"><label>Art</label><select name="heim"><option value="true">Heimspiel</option><option value="false">Auswärts</option></select></div>
      <div class="feld" style="flex-basis:100%"><label>Hinweis (optional)</label><input type="text" name="hinweis" maxlength="300" placeholder="z. B. Treffpunkt 13:45 Uhr"></div>
      <button class="knopf">Speichern</button>
      <button class="knopf zweit" type="reset" data-aktion="spiel-abbrechen">Leeren</button>
    </form>
  </details>`;
}

let offeneSpiele = null; // welche Heimspiel-Karten aufgeklappt sind
const meinName = () => gemerkterName().trim();

// Wird ein Artikel bei diesem Spiel gebraucht? Grundeinstellung ("immer" oder "bei Bedarf"), pro Spiel umschaltbar.
const mengenAnders = (s) => Object.fromEntries((s.mengen || "").split(",").map((x) => x.split("=")).filter((x) => x.length === 2 && x[0].trim()).map(([k, v]) => [k.trim(), Math.max(1, parseInt(v, 10) || 1)]));
const mengeFuer = (s, a) => mengenAnders(s)[a.name] ?? a.bedarf;
const anders = (s) => (s.artikelAnders || "").split(",").map((x) => x.trim()).filter(Boolean);
const gebraucht = (s, a) => (a.immer !== false) !== anders(s).includes(a.name);

// ---------- Vorrat und Wäsche ----------
const slug = (t) => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function vorratStand(name) {
  const v = (Z.vorrat || []).find((x) => x.id === slug(name));
  if (!v || v.status === "ok") return { status: "ok", v };
  const seit = v.datum || (v.geaendert || v.erstellt || "").slice(0, 10);
  // Wurde der Artikel nach der Meldung bei einem inzwischen gespielten Heimspiel mitgebracht, gilt er als aufgefüllt
  const aufgefuellt = Z.catering.some((c) => {
    if (c.artikel !== name) return false;
    const sp = Z.spiele.find((x) => x.id === c.spielId);
    return sp && sp.datum >= seit && sp.datum < heute();
  });
  return aufgefuellt ? { status: "ok", v, aufgefuellt: true } : { status: v.status, v };
}

// ---------- Zeitnehmer ----------
const zeitnehmerPlaetze = () => Z.einstellungen.zeitnehmerPlaetze ?? 1;
const zeitnehmerNoetig = (s) => zeitnehmerPlaetze() > 0 && (Z.einstellungen.zeitnehmerBei !== "heim" || s.heim);
const zeitnehmerVon = (s) => (Z.zeitnehmer || []).filter((x) => x.spielId === s.id);
const zeitnehmerFehlt = (s) => zeitnehmerNoetig(s) && zeitnehmerVon(s).length < zeitnehmerPlaetze();
function zeitnehmerAufgabe(s) {
  if (!zeitnehmerNoetig(s)) return null;
  const zn = zeitnehmerVon(s);
  const fehlt = zn.length < zeitnehmerPlaetze();
  const dringend = fehlt && (datum(s.datum) - datum(heute())) / 864e5 <= 7;
  const eigen = zn.find((z) => darfLoeschen(z) && z.eigen);
  return {
    status: fehlt ? (dringend ? "dringend" : "offen") : "ok",
    titel: "Zeitnehmer", kurz: "Zeitnehmer",
    stand: fehlt ? (dringend ? "dringend gesucht" : "offen") : "",
    detail: zn.length ? wer(zn) + (eigen ? ` · <button class="link-knopf" data-aktion="loeschen" data-col="zeitnehmer" data-id="${eigen.id}" data-frage="Als Zeitnehmer austragen?">austragen</button>` : "") : (dringend ? "Ohne Zeitnehmer droht eine Strafe." : ""),
    knopf: fehlt ? `<button class="knopf klein" data-aktion="zeitnehmer-ich" data-spiel="${s.id}">Ich mache das</button>` : "",
  };
}
const zeitnehmerZeile = (s) => { const a = zeitnehmerAufgabe(s); return a ? aufgabe(a) : ""; };
// Kurzform für die Spieleliste
function zeitnehmerKurz(s) {
  if (!zeitnehmerNoetig(s)) return "";
  const zn = zeitnehmerVon(s);
  return zn.length >= zeitnehmerPlaetze()
    ? `<div class="zn-kurz ok">Zeitnehmer: ${wer(zn)}</div>`
    : `<div class="zn-kurz offen">Zeitnehmer gesucht · <button class="link-knopf" data-aktion="zeitnehmer-ich" data-spiel="${s.id}">Ich mache das</button></div>`;
}

// ---------- Wäsche: wer nimmt nach dem Heimspiel Geschirrtücher und Spüllappen mit ----------
const waescheText = () => { const w = Z.einstellungen.waescheArtikel || []; return w.length > 1 ? `${w.slice(0, -1).join(", ")} und ${w.at(-1)}` : w[0] || ""; };
const waescheNoetig = (s) => s.heim && (Z.einstellungen.waescheArtikel || []).length > 0;
const waescheVon = (s) => (Z.waschdienst || []).find((x) => x.spielId === s.id);
const waescheFehlt = (s) => waescheNoetig(s) && !waescheVon(s);
const vorherigesHeim = (s) => heimspiele().filter((x) => x.datum < s.datum).sort((a, b) => b.datum.localeCompare(a.datum))[0];
function waescheAufgabe(s) {
  if (!waescheNoetig(s)) return null;
  const w = waescheVon(s);
  const vor = vorherigesHeim(s);
  const bringt = vor && waescheVon(vor);
  return {
    status: w ? "ok" : "offen",
    titel: "Wäsche nach dem Spiel", kurz: "Wäsche",
    stand: w ? "" : "offen",
    detail: `${w ? wer([w]) + (darfLoeschen(w) && w.eigen ? ` · <button class="link-knopf" data-aktion="loeschen" data-col="waschdienst" data-id="${w.id}" data-frage="Austragen?">austragen</button>` : "") + " · " : ""}${esc(waescheText())}: mitnehmen, waschen, nächstes Heimspiel wieder mitbringen${bringt ? `. Bringt diesmal mit: ${esc(anzeigeName(bringt.name))}` : ""}`,
    knopf: w ? "" : `<button class="knopf klein zweit" data-aktion="waesche-ich" data-spiel="${s.id}">Ich nehme sie mit</button>`,
  };
}
const waescheZeile = (s) => { const a = waescheAufgabe(s); return a ? aufgabe(a) : ""; };
function trikotAufgabe(s) {
  const p = trikotPlan().find((x) => x.spiel.id === s.id);
  if (!p) return null;
  const wer = p.familie.replace(/^Familie von /, "");
  const ihr = meinKind() && wer === meinKind();
  return {
    status: p.erledigt ? "ok" : "info",
    titel: "Trikots waschen",
    stand: esc(wer) + (ihr ? ` <span class="pill offen">das seid ihr</span>` : ""),
    detail: p.erledigt ? "erledigt, danke!" : "Satz nach dem Spiel mitnehmen, gewaschen zum nächsten Spiel",
    knopf: `<a class="link-knopf" href="#/trikots">${ihr ? "tauschen" : "Plan"}</a>`,
  };
}

function cateringStatus(s) {
  const e = Z.einstellungen;
  const dienst = Z.standdienst.filter((x) => x.spielId === s.id && !x.reserve).length;
  // Vorrat: was leer oder knapp ist, steht beim nächsten Heimspiel auf der Mitbringliste
  const naechstesHeim = kommende(heimspiele())[0];
  const vorrat = (e.vorratArtikel || []).filter((a) => Z.catering.some((c) => c.spielId === s.id && c.artikel === a.name)
    || (naechstesHeim && naechstesHeim.id === s.id && vorratStand(a.name).status !== "ok"))
    .map((a) => ({ ...a, bedarf: 1, vorrat: true, stand: vorratStand(a.name).status }));
  const artikel = [...e.cateringArtikel.filter((a) => gebraucht(s, a)).map((a) => ({ ...a, bedarf: mengeFuer(s, a), standard: a.bedarf })), ...vorrat].map((a) => ({
    ...a, zugesagt: Z.catering.filter((c) => c.spielId === s.id && c.artikel === a.name).length,
  }));
  const offen = artikel.filter((a) => a.zugesagt < a.bedarf);
  return { dienst: Math.min(dienst, e.standdienstPlaetze), plaetze: e.standdienstPlaetze, artikel, offen, komplett: dienst >= e.standdienstPlaetze && !offen.length };
}
const pill = (ist, soll, text = `${ist}/${soll}`) =>
  `<span class="pill ${ist >= soll ? "ok" : "offen"}">${ist >= soll ? "✓ " : ""}${text}</span>`;

function vorratKarte() {
  const e = Z.einstellungen;
  const va = e.vorratArtikel || [];
  if (!va.length) return "";
  const staende = va.map((a) => ({ a, st: vorratStand(a.name) }));
  const fehlend = staende.filter((x) => x.st.status !== "ok");
  const kurz = fehlend.length ? `${fehlend.map((x) => x.a.name).join(", ")} ${fehlend.length === 1 ? "fehlt" : "fehlen"}` : "Vorrat ok";
  const knopf = (a, status, text) => `<button class="seg ${vorratStand(a.name).status === status && (status !== "ok" || !vorratStand(a.name).v || true) ? "an" : ""} ${status}" data-aktion="vorrat-setzen" data-artikel="${esc(a.name)}" data-status="${status}">${text}</button>`;
  return `<details class="karte vorrat-karte">
    <summary><span>Vorrat</span> <span class="pill ${fehlend.length ? "offen" : "ok"}">${esc(kurz)}</span></summary>
    <p class="leise klein">Bitte nach jedem Heimspiel kurz antippen. Was <strong>leer</strong> oder <strong>knapp</strong> ist, steht automatisch auf der Mitbringliste fürs nächste Heimspiel.</p>
    ${va.length ? `<ul class="liste">${staende.map(({ a, st }) => `<li>
      <div><strong>${esc(a.name)}</strong>${st.v && st.status !== "ok" && st.v.von ? `<div class="leise klein">gemeldet von ${esc(st.v.von.split(" (")[0])}</div>` : st.aufgefuellt ? `<div class="leise klein">wurde aufgefüllt</div>` : ""}</div>
      <div class="segment">${knopf(a, "ok", "reicht")}${knopf(a, "knapp", "knapp")}${knopf(a, "leer", "leer")}</div></li>`).join("")}</ul>` : ""}
  </details>`;
}

function cateringDetails(s) {
  const e = Z.einstellungen;
    const st = cateringStatus(s);
    const alle = Z.standdienst.filter((x) => x.spielId === s.id).sort((a, b) => a.erstellt.localeCompare(b.erstellt));
    const dienst = alle.filter((x) => !x.reserve);
    const reserve = alle.filter((x) => x.reserve);
    const frei = Math.max(0, st.plaetze - dienst.length);
    const reserveFrei = Math.max(0, (e.reservePlaetze ?? 1) - reserve.length);
    const eintrag = (d) => `<li><span><span class="haken">✓</span><strong>${esc(anzeigeName(d.name))}</strong>${d.hinweis ? ` <span class="leise">· ${esc(d.hinweis)}</span>` : ""}</span>
        ${darfLoeschen(d) ? `<button class="link-knopf" data-aktion="loeschen" data-col="standdienst" data-id="${d.id}" data-frage="Eintrag entfernen?">austragen</button>` : ""}</li>`;
    const plaetze = [
      ...dienst.map(eintrag),
      ...Array.from({ length: frei }, () => `<li><span class="platz-frei">Platz frei</span>
        <button class="knopf klein" data-aktion="standdienst-ich" data-spiel="${s.id}">Ich übernehme</button></li>`),
    ].join("");
    const reservePlaetze = [
      ...reserve.map(eintrag),
      ...Array.from({ length: reserveFrei }, () => `<li><span class="platz-frei">Reserve frei</span>
        <button class="knopf klein zweit" data-aktion="standdienst-ich" data-reserve="1" data-spiel="${s.id}">Als Reserve</button></li>`),
    ].join("");
    const artikel = st.artikel.map((a, i) => {
      const zusagen = Z.catering.filter((c) => c.spielId === s.id && c.artikel === a.name);
      const voll = a.zugesagt >= a.bedarf;
      const key = `${s.id}-${i}`;
      return `<li style="display:block">
        <div class="artikel-zeile">
          <div class="artikel-name"><strong>${esc(a.name)}</strong> ${pill(a.zugesagt, a.bedarf)}${a.vorrat ? ` <span class="pill neutral">Vorrat ${a.stand === "leer" ? "leer" : a.stand === "knapp" ? "knapp" : "auffüllen"}</span>` : ""}${a.hinweis ? `<span class="leise klein artikel-hinweis">je ${esc(a.hinweis)}</span>` : ""}</div>
          <button class="${voll ? "link-knopf" : "knopf klein zweit"}" data-aktion="mitbringen-oeffnen" data-key="${key}">${voll ? "+ zusätzlich" : "Ich bringe mit"}</button>
        </div>
        ${istAdmin() && !a.vorrat ? `<div class="artikel-admin"><span class="menge-stepper" title="Anzahl für dieses Spiel"><button class="mini" data-aktion="menge-aendern" data-spiel="${s.id}" data-artikel="${esc(a.name)}" data-delta="-1" ${a.bedarf <= 1 ? "disabled" : ""} aria-label="weniger">−</button><span>${a.bedarf}×</span><button class="mini" data-aktion="menge-aendern" data-spiel="${s.id}" data-artikel="${esc(a.name)}" data-delta="1" aria-label="mehr">+</button></span>${a.bedarf !== a.standard ? `<span class="leise klein">sonst ${a.standard}×</span>` : ""}<button class="link-knopf klein" data-aktion="artikel-umschalten" data-spiel="${s.id}" data-artikel="${esc(a.name)}">diesmal nicht nötig</button></div>` : ""}
        ${zusagen.length ? `<div>${zusagen.map((c) => `<span class="chip">${esc(anzeigeName(c.name))}${c.menge ? " · " + esc(c.menge) : ""}${darfLoeschen(c) ? `<button class="x" title="entfernen" data-aktion="loeschen" data-col="catering" data-id="${c.id}" data-frage="Zusage entfernen?">×</button>` : `<span style="width:6px"></span>`}</span>`).join("")}</div>` : ""}
        <form class="zeile mitbringen" data-form="catering" data-spiel="${s.id}" data-key="${key}" hidden>
          <input type="hidden" name="artikel" value="${esc(a.name)}">
          <div class="feld"><input type="text" name="menge" maxlength="60" placeholder="Menge, z. B. 1 Blech (optional)" aria-label="Menge"></div>
          <button class="knopf klein">Zusagen</button>
        </form>
      </li>`;
    }).join("");
    const status = st.komplett
      ? `<span class="pill ok">✓ Alles besetzt</span>`
      : `${pill(st.dienst, st.plaetze, `Standdienst ${st.dienst}/${st.plaetze}`)} ${!st.offen.length ? "" : st.offen.length === st.artikel.length ? `<span class="pill offen">Mitbringliste offen</span>` : `<span class="pill offen">Offen: ${st.offen.map((a) => esc(a.name)).join(", ")}</span>`}`;
    return `<div class="raster-2 abstand">
        <div><h3>Standdienst</h3>
          <p class="info-zeile">${treffzeit(s) ? `Bitte spätestens um <strong>${treffzeit(s)} Uhr</strong> da sein.` : `Bitte mindestens ${Z.einstellungen.standdienstVorlauf ?? 60} Minuten vor Anpfiff da sein.`} ${esc(Z.einstellungen.standdienstInfo || "")}</p>
          <ul class="liste">${plaetze}</ul>
          ${reservePlaetze ? `<h3 class="abstand" style="margin-bottom:2px">Reserve</h3>
          <p class="leise klein" style="margin:0 0 4px">Springt ein, wenn jemand ausfällt.</p>
          <ul class="liste">${reservePlaetze}</ul>` : ""}</div>
        <div><h3>Mitbringliste</h3><ul class="liste">${artikel}</ul>
          ${istAdmin() ? Z.einstellungen.cateringArtikel.filter((a) => !gebraucht(s, a)).map((a) => `<p class="nicht-noetig">${esc(a.name)}: diesmal nicht nötig
            <button class="link-knopf" data-aktion="artikel-umschalten" data-spiel="${s.id}" data-artikel="${esc(a.name)}">+ diesmal brauchen</button></p>`).join("") : ""}</div>
      </div>`;
}

// Alte Adressen #/catering und #/fahrten zeigen die Spiele-Seite mit passendem Filter
function seiteCatering() { spieleFilter = "heim"; return seiteSpiele(); }

function seiteTrikots() {
  const plan = trikotPlan();
  const fam = familien();
  const naechstes = plan.find((p) => !p.erledigt && p.spiel.datum >= heute());
  const kurz = (f) => f.replace(/^Familie von /, "");
  return `${kopfzeile("Reihum, jede Familie ist dran", "Trikots waschen")}
  ${naechstes ? `<section class="karte trikot-naechstes"><span class="kachel-label">Als Nächstes dran</span>
    <div class="trikot-wer">${esc(kurz(naechstes.familie))}${meinKind() && kurz(naechstes.familie) === meinKind() ? ` <span class="pill offen">das seid ihr</span>` : ""}</div>
    <div class="leise">nach dem Spiel am ${wochentagKurz(naechstes.spiel.datum)} ${kurzDatum(naechstes.spiel.datum)} ${naechstes.spiel.heim ? "gegen" : "bei"} ${esc(naechstes.spiel.gegner)}</div></section>` : ""}
  <div class="hinweis info">Die Reihenfolge ergibt sich aus dem Kader. Nach jedem Spiel nimmt die eingetragene Familie den Trikotsatz mit, wäscht ihn und bringt ihn zum nächsten Spiel wieder mit. Wer nicht kann, tauscht einfach mit einer anderen Familie und ändert es hier.</div>
  ${fam.length < 2 ? `<div class="hinweis">Es sind erst ${fam.length} Spieler im Kader eingetragen. Die Kassenführung ergänzt den Kader unter Verwaltung, dann verteilt sich der Plan automatisch.</div>` : ""}
  <section class="karte">
    ${plan.length ? `<div class="tabelle-wrap"><table>
      <thead><tr><th>Spiel</th><th>Wer</th><th>Erledigt</th><th></th></tr></thead>
      <tbody>${plan.map((p) => `<tr class="${p.erledigt ? "erledigt" : ""} ${p === naechstes ? "naechstes" : ""}">
        <td><strong>${datumKurz(p.spiel.datum)}</strong><div class="leise">${p.spiel.heim ? "Heim" : "Auswärts"} gegen ${esc(p.spiel.gegner)}</div></td>
        <td><strong>${esc(kurz(p.familie))}</strong>${p.getauscht ? ` <span class="leise klein">(getauscht)</span>` : ""}</td>
        <td><input type="checkbox" aria-label="erledigt" data-aktion="trikot-erledigt" data-id="${p.spiel.id}" ${p.erledigt ? "checked" : ""}></td>
        <td><select class="klein" data-aktion="trikot-tausch" data-id="${p.spiel.id}" aria-label="Familie ändern" style="padding:5px 8px;font-size:13px;width:auto">
          <option value="">${p.getauscht ? "Ursprüngliche Familie" : "Familie ändern …"}</option>
          ${fam.filter((f) => f !== p.familie).map((f) => `<option value="${esc(f)}">${esc(kurz(f))}</option>`).join("")}</select></td>
      </tr>`).join("")}</tbody></table></div>`
      : `<p class="leer">Noch keine Spiele eingetragen.</p>`}
  </section>`;
}

function kasseEinfach() {
  const e = Z.einstellungen;
  const { saldo } = kassenSummen();
  const letzte = kassenBuchungen().reverse().slice(0, 5);
  return `${kopfzeile("Transparent für alle Eltern", "Mannschaftskasse")}
  <section class="karte kasse-gross">
    <div class="kachel-label">Aktueller Kassenstand</div>
    <div class="zahl-riesig ${saldo < 0 ? "minus" : ""}">${euro(saldo)}</div>
  </section>
  <section class="karte abstand">
    <h2>Letzte Buchungen</h2>
    ${letzte.length ? `<ul class="liste">${letzte.map((b) => `<li>
      <div><strong>${esc(b.zweck)}</strong><div class="leise klein">${datumKurz(b.datum)} · ${esc(b.kanal)}</div></div>
      <strong class="${b.art === "einnahme" ? "plus" : "minus"}" style="white-space:nowrap">${b.art === "einnahme" ? "+" : "−"} ${euro(b.betrag)}</strong></li>`).join("")}</ul>`
      : `<p class="leer">Noch keine Buchungen.</p>`}
    <button class="knopf zweit abstand" data-aktion="kassen-details">Alle Details anzeigen</button>
  </section>`;
}

function seiteKasse() {
  if (!istAdmin() && !kassenDetails) return kasseEinfach();
  const e = Z.einstellungen;
  const { ein, aus, saldo } = kassenSummen();
  const buchungen = kassenBuchungen();
  let lauf = e.anfangsbestand;
  const mitSaldo = buchungen.map((b) => {
    lauf += b.art === "einnahme" ? b.betrag : -b.betrag;
    return { ...b, saldo: lauf };
  });
  const gefiltert = mitSaldo.filter((b) => kassenFilter === "alle" || b.art === kassenFilter).reverse();
  const gruppe = (art, feld) => {
    const m = new Map();
    buchungen.filter((b) => b.art === art).forEach((b) => m.set(b[feld] || "ohne Angabe", (m.get(b[feld] || "ohne Angabe") || 0) + b.betrag));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const balken = (eintraege, summe, farbe) => eintraege.length ? `<ul class="liste">${eintraege.map(([k, v]) => `<li style="display:block">
      <div class="ausrichten" style="justify-content:space-between"><span>${esc(k)}</span><strong>${euro(v)}</strong></div>
      <div class="fortschritt"><div style="width:${summe ? (v / summe) * 100 : 0}%;background:${farbe}"></div></div></li>`).join("")}</ul>`
    : `<p class="leer">Noch keine Buchungen.</p>`;
  const opt = (liste, wert) => liste.map((x) => `<option ${x === wert ? "selected" : ""}>${esc(x)}</option>`).join("");
  return `${kopfzeile("Transparent für alle Eltern", "Mannschaftskasse")}
  ${!istAdmin() ? `<p><button class="link-knopf" data-aktion="kassen-details">‹ Zurück zur einfachen Ansicht</button></p>` : ""}
  <div class="raster">
    <section class="karte"><div class="kachel-label">Kassenstand</div><div class="zahl-gross ${saldo < 0 ? "minus" : ""}">${euro(saldo)}</div>
      <p class="leise" style="margin:0">Anfangsbestand ${euro(e.anfangsbestand)} am ${datumKurz(e.anfangsdatum)}</p></section>
    <section class="karte"><div class="kachel-label">Einnahmen</div><div class="zahl-gross" style="color:var(--gruen)">${euro(ein)}</div></section>
    <section class="karte"><div class="kachel-label">Ausgaben</div><div class="zahl-gross" style="color:var(--rot)">${euro(aus)}</div></section>
  </div>
  <div class="raster-2 abstand">
    <section class="karte"><h2>Einnahmen nach Zahlungsart</h2>${balken(gruppe("einnahme", "kanal"), ein, "var(--gruen)")}</section>
    <section class="karte"><h2>Ausgaben nach Zweck</h2>${balken(gruppe("ausgabe", "kategorie"), aus, "var(--rot)")}</section>
  </div>

  ${spielErgebnisse()}
  ${abrechnungsFormular()}
  <details class="karte abstand nur-kasse formular-klappe" id="buchung-klappe"><summary id="buchung-titel">Einzelne Buchung erfassen</summary>
    <form class="zeile abstand" data-form="kasse">
      <input type="hidden" name="id">
      <div class="feld" style="flex-basis:150px"><label>Datum</label><input type="date" name="datum" required value="${heute()}"></div>
      <div class="feld" style="flex-basis:130px"><label>Art</label><select name="art"><option value="einnahme">Einnahme</option><option value="ausgabe">Ausgabe</option></select></div>
      <div class="feld" style="flex-basis:120px"><label>Betrag (€)</label><input type="text" name="betrag" inputmode="decimal" required placeholder="0,00"></div>
      <div class="feld" style="flex-basis:260px"><label>Zweck</label><input type="text" name="zweck" required maxlength="120" placeholder="z. B. Catering Heimspiel gegen BHC III"></div>
      <div class="feld"><label>Kategorie</label><select name="kategorie">${opt(e.kassenKategorien)}</select></div>
      <div class="feld"><label>bezahlt per</label><select name="kanal">${opt(e.kassenKanaele)}</select></div>
      <div class="feld"><label>Spiel (optional)</label><select name="spielId"><option value="">–</option>${spieleSortiert().map((s) => `<option value="${s.id}">${datumKurz(s.datum)} ${esc(s.gegner)}</option>`).join("")}</select></div>
      <div class="feld"><label>Beleg / Notiz</label><input type="text" name="beleg" maxlength="120" placeholder="z. B. Kassenbon Rewe"></div>
      <button class="knopf">Speichern</button>
      <button class="knopf zweit" type="reset" data-aktion="buchung-abbrechen">Leeren</button>
    </form>
  </details>

  <section class="karte abstand">
    <div class="karte-kopf"><h2 style="margin:0">Buchungen</h2>
      <div class="ausrichten">
        <div class="tabs" style="margin:0">${[["alle", "Alle"], ["einnahme", "Einnahmen"], ["ausgabe", "Ausgaben"]].map(([k, t]) => `<button class="tab ${kassenFilter === k ? "aktiv" : ""}" data-aktion="kassenfilter" data-wert="${k}">${t}</button>`).join("")}</div>
        <button class="knopf zweit klein" data-aktion="csv">CSV-Export</button>
      </div></div>
    ${gefiltert.length ? `<div class="tabelle-wrap"><table>
      <thead><tr><th>Datum</th><th>Zweck</th><th>Bezahlt per</th><th class="betrag">Betrag</th><th class="betrag">Stand</th><th class="nur-kasse"></th></tr></thead>
      <tbody>${gefiltert.map((b) => `<tr>
        <td>${datumKurz(b.datum)}</td>
        <td><strong>${esc(b.zweck)}</strong><div class="leise klein">${esc(b.kategorie)}${b.spielId && spielName(b.spielId) ? " · " + esc(spielName(b.spielId)) : ""}${b.beleg ? " · " + esc(b.beleg) : ""}</div></td>
        <td>${esc(b.kanal)}</td>
        <td class="betrag ${b.art === "einnahme" ? "plus" : "minus"}">${b.art === "einnahme" ? "+" : "−"} ${euro(b.betrag)}</td>
        <td class="betrag">${euro(b.saldo)}</td>
        <td class="nur-kasse" style="white-space:nowrap"><button class="link-knopf" data-aktion="buchung-bearbeiten" data-id="${b.id}">ändern</button>
          <button class="link-knopf" style="color:var(--rot);margin-left:8px" data-aktion="loeschen" data-col="kasse" data-id="${b.id}" data-frage="Buchung wirklich löschen?">löschen</button></td>
      </tr>`).join("")}</tbody></table></div>`
      : `<p class="leer">Noch keine Buchungen.</p>`}
  </section>`;
}

function seiteGalerie() {
  if (!Z.einstellungen.galerieAktiv && !istAdmin()) {
    return `${kopfzeile("Erinnerungen der Saison", "Galerie")}<section class="karte"><p>Die Galerie startet, sobald mit dem Verein alles abgestimmt ist.</p></section>`;
  }
  if (!galerieGeladen) {
    api("GET", "/api/galerie").then((g) => { galerie = g; galerieGeladen = true; zeigen(); })
      .catch((e) => meldung(e.message, true));
    return `${kopfzeile("Erinnerungen der Saison", "Galerie")}<p class="leer">Lade Fotos …</p>`;
  }
  const alben = ["Alle", ...new Set(galerie.map((f) => f.album))];
  if (!alben.includes(albumFilter)) albumFilter = "Alle";
  const sichtbar = galerie.filter((f) => albumFilter === "Alle" || f.album === albumFilter);
  const gemeldet = galerie.filter((f) => f.gemeldet).length;
  const albumVorschlaege = [...new Set([...galerie.map((f) => f.album), ...heimspiele().concat(vergangene(spieleSortiert())).map((s) => `${datumKurz(s.datum)} ${s.gegner}`)])];
  return `${kopfzeile("Erinnerungen der Saison", "Galerie")}
  ${istAdmin() && !Z.einstellungen.galerieAktiv ? `<div class="hinweis">Die Galerie ist für Eltern noch ausgeblendet. Freigabe unter Verwaltung.</div>` : ""}
  ${istAdmin() && gemeldet ? `<div class="hinweis">${gemeldet} Foto${gemeldet === 1 ? " wurde" : "s wurden"} zur Prüfung gemeldet und ist für Eltern ausgeblendet. Rot markiert, bitte prüfen.</div>` : ""}
  <details class="karte" ${galerie.length ? "" : "open"}>
    <summary>Fotos hochladen</summary>
    <div class="hinweis">Bitte nur Fotos hochladen, mit denen die abgebildeten Jungs und deren Eltern einverstanden sind. Keine Fotos aus der Umkleide, keine peinlichen Situationen. Fotos werden vor dem Hochladen verkleinert, Standortdaten werden dabei entfernt.</div>
    <div class="hinweis info">📸 <strong>Datensparsam knipsen 😉</strong> Lieber das eine Siegerfoto als 47 fast gleiche Serienbilder. Sucht die besten 5 bis 10 Bilder pro Spiel aus, der Rest darf gern auf dem eigenen Handy bleiben. Das schont Speicher, Datenvolumen und die Nerven aller, die durchscrollen.</div>
    <form class="zeile" data-form="galerie">
      <div class="feld"><label>Album</label><input type="text" name="album" list="alben" required maxlength="80" placeholder="z. B. 10.10.2026 Bergischer HC III"><datalist id="alben">${albumVorschlaege.map((a) => `<option value="${esc(a)}">`).join("")}</datalist></div>
      <div class="feld"><label>Dein Name</label><input type="text" name="name" maxlength="60" value="${esc(gemerkterName())}"></div>
      <div class="feld" style="flex-basis:100%"><label>Fotos (mehrere möglich)</label><input type="file" name="dateien" accept="image/*" multiple required></div>
      <button class="knopf">Hochladen</button>
      <div style="flex-basis:100%" id="upload-status"></div>
    </form>
  </details>
  <section class="karte abstand">
    <div class="tabs">${alben.map((a) => `<button class="tab ${a === albumFilter ? "aktiv" : ""}" data-aktion="album" data-wert="${esc(a)}">${esc(a)}</button>`).join("")}</div>
    ${sichtbar.length ? `<div class="galerie">${sichtbar.map((f, i) => `<button class="foto ${f.gemeldet ? "gemeldet" : ""}" data-aktion="foto" data-index="${i}" aria-label="Foto öffnen">
      <img src="/api/foto/${f.id}/klein" loading="lazy" alt="${esc(f.titel || f.album)}">${f.gemeldet ? `<span class="marke-gemeldet">gemeldet</span>` : ""}</button>`).join("")}</div>`
      : `<p class="leer">Noch keine Fotos in diesem Album.</p>`}
  </section>`;
}

function seiteVerwaltung() {
  if (!istAdmin()) return `${kopfzeile("", "Verwaltung")}<p>Nur für die Kassenführung.</p>`;
  const e = Z.einstellungen;
  const trainer = [...Z.trainer].sort((a, b) => a.reihenfolge - b.reihenfolge);
  const bereich = (titel, unter, inhalt, offen = false) => `<details class="karte verwaltung-bereich formular-klappe" ${offen ? "open" : ""}><summary><span>${titel}<span class="leise klein bereich-unter">${unter}</span></span></summary><div class="abstand">${inhalt}</div></details>`;
  const kaderHtml = `<p class="leise klein">Nur Vornamen. Die Reihenfolge bestimmt den Trikot-Waschplan.</p>
      <ul class="liste">${kader().map((k, i) => `<li><span>${i + 1}. <strong>${esc(k.vorname)}</strong>${k.nummer ? ` <span class="leise">#${esc(k.nummer)}</span>` : ""}</span>
        <button class="link-knopf" style="color:var(--rot)" data-aktion="loeschen" data-col="kader" data-id="${k.id}" data-frage="${esc(k.vorname)} aus dem Kader entfernen?">entfernen</button></li>`).join("")}</ul>
      <form class="zeile abstand" data-form="kader">
        <div class="feld"><label>Vorname</label><input type="text" name="vorname" required maxlength="30"></div>
        <div class="feld" style="flex-basis:80px"><label>Nr.</label><input type="text" name="nummer" maxlength="3"></div>
        <div class="feld" style="flex-basis:90px"><label>Reihenf.</label><input type="number" name="reihenfolge" value="${kader().length + 1}"></div>
        <button class="knopf">Hinzufügen</button>
      </form>`;
  const trainerHtml = `<div class="raster">${trainer.map((t) => `<section class="karte flach"><form data-form="trainer" data-id="${t.id}">
      <label>Name</label><input type="text" name="name" value="${esc(t.name)}" maxlength="80" required>
      <div class="ausrichten abstand" style="margin-top:8px">
        <div class="feld"><label>Rolle</label><input type="text" name="rolle" value="${esc(t.rolle)}" maxlength="60"></div>
        <div class="feld" style="flex-basis:80px"><label>Reihenf.</label><input type="number" name="reihenfolge" value="${t.reihenfolge}"></div>
      </div>
      <label class="abstand" style="margin-top:8px">Text</label><textarea name="text" maxlength="1500">${esc(t.text)}</textarea>
      <div class="ausrichten abstand" style="margin-top:8px"><button class="knopf klein">Speichern</button>
        <button type="button" class="knopf klein gefahr" data-aktion="loeschen" data-col="trainer" data-id="${t.id}" data-frage="Trainer entfernen?">Entfernen</button></div>
    </form></section>`).join("")}
    <section class="karte flach"><form data-form="trainer-neu">
      <h3>Trainer hinzufügen</h3>
      <label>Name</label><input type="text" name="name" maxlength="80" required>
      <label class="abstand" style="margin-top:8px">Rolle</label><input type="text" name="rolle" value="Trainer" maxlength="60">
      <button class="knopf klein abstand">Hinzufügen</button>
    </form></section></div>`;
  const gruppe = (titel, inhalt) => `<fieldset class="einst-gruppe"><legend>${titel}</legend>${inhalt}</fieldset>`;
  const einstellungen = `<form data-form="einstellungen">
    ${gruppe("Mannschaft und Training", `
      <label>Liga</label><input type="text" name="liga" value="${esc(e.liga)}">
      <label class="abstand">Text zur Mannschaft</label><textarea name="teamText">${esc(e.teamText)}</textarea>
      <label class="abstand">Hallen mit Adresse (je Zeile: Name | Straße Nr., PLZ Ort). Daraus entsteht der Knopf „Route“.</label>
      <textarea name="hallen" style="min-height:90px" placeholder="Humboldt | Humboldtstraße 1, 42651 Solingen">${esc((e.hallen || []).map((h) => `${h.name} | ${h.adresse}`).join("\n"))}</textarea>
      <label class="abstand">Trainingszeiten (je Zeile: Tag | Uhrzeit | Halle). Hallenname wie oben, dann erscheint die Route.</label>
      <textarea name="trainingszeiten" style="min-height:70px">${esc(e.trainingszeiten.map((t) => `${t.tag} | ${t.zeit} | ${t.halle}`).join("\n"))}</textarea>`)}
    ${gruppe("Heimspiel-Catering", `
      <div class="ausrichten">
        <div class="feld"><label>Standdienst-Plätze pro Heimspiel</label><input type="number" min="1" max="10" name="standdienstPlaetze" value="${e.standdienstPlaetze}"></div>
        <div class="feld"><label>Reserveplätze</label><input type="number" min="0" max="5" name="reservePlaetze" value="${e.reservePlaetze ?? 1}"></div>
        <div class="feld" style="flex-basis:200px"><label>In der Halle sein (Minuten vor Anwurf, für Standdienst und Jungs)</label><input type="number" min="0" max="180" name="standdienstVorlauf" value="${e.standdienstVorlauf ?? 60}"></div>
      </div>
      <label class="abstand">Infotext Standdienst</label><textarea name="standdienstInfo" style="min-height:70px" maxlength="400">${esc(e.standdienstInfo || "")}</textarea>
      <label class="abstand">Mitbringliste (je Zeile: Artikel | Anzahl | Menge je Zusage | „bei Bedarf“, wenn nicht jedes Spiel nötig)</label>
      <textarea name="cateringArtikel" style="min-height:110px">${esc(e.cateringArtikel.map((a) => `${a.name} | ${a.bedarf} | ${a.hinweis || ""}${a.immer === false ? " | bei Bedarf" : ""}`).join("\n"))}</textarea>
      <label class="abstand">Vorrat (je Zeile: Artikel | Menge beim Nachkaufen)</label>
      <textarea name="vorratArtikel" style="min-height:90px">${esc((e.vorratArtikel || []).map((a) => `${a.name} | ${a.hinweis || ""}`).join("\n"))}</textarea>
      <label class="abstand">Wäsche, die nach jedem Heimspiel jemand mitnimmt (ein Teil pro Zeile, leer = aus)</label>
      <textarea name="waescheArtikel" style="min-height:60px">${esc((e.waescheArtikel || []).join("\n"))}</textarea>`)}
    ${gruppe("Zeitnehmer", `
      <div class="ausrichten">
        <div class="feld" style="flex-basis:200px"><label>Zeitnehmer gebraucht bei</label><select name="zeitnehmerBei"><option value="alle" ${e.zeitnehmerBei !== "heim" ? "selected" : ""}>allen Spielen</option><option value="heim" ${e.zeitnehmerBei === "heim" ? "selected" : ""}>nur Heimspielen</option></select></div>
        <div class="feld" style="flex-basis:140px"><label>Zeitnehmer pro Spiel</label><input type="number" min="0" max="3" name="zeitnehmerPlaetze" value="${e.zeitnehmerPlaetze ?? 1}"></div>
      </div>`)}
    ${gruppe("Kasse", `
      <div class="ausrichten">
        <div class="feld"><label>Anfangsbestand (€)</label><input type="text" name="anfangsbestand" inputmode="decimal" value="${(e.anfangsbestand / 100).toFixed(2).replace(".", ",")}"></div>
        <div class="feld"><label>Stichtag</label><input type="date" name="anfangsdatum" value="${esc(e.anfangsdatum)}"></div>
      </div>
      <label class="abstand">Kassen-Kategorien (eine pro Zeile)</label>
      <textarea name="kassenKategorien" style="min-height:90px">${esc(e.kassenKategorien.join("\n"))}</textarea>
      <label class="abstand">Zahlungskanäle (einer pro Zeile)</label>
      <textarea name="kassenKanaele" style="min-height:70px">${esc(e.kassenKanaele.join("\n"))}</textarea>`)}
    ${gruppe("Galerie und handball.net", `
      <label class="schalter"><input type="checkbox" name="galerieAktiv" ${e.galerieAktiv ? "checked" : ""}> Galerie für Eltern freigeben</label>
      <label class="abstand">Link zur Mannschaft auf handball.net</label>
      <input type="text" name="handballNetUrl" value="${esc(e.handballNetUrl)}">
      <label class="abstand">handball.net Widget-Token (optional)</label>
      <input type="text" name="widgetToken" value="${esc(e.widgetToken)}" placeholder="z. B. 585937e1379b81a963168635">
      <p class="leise klein">Zu finden auf handball.net im Reiter Spielplan unter „Füge den Spielplan deiner Website hinzu“.</p>`)}
    <div class="speichern-leiste"><button class="knopf">Einstellungen speichern</button></div>
  </form>`;
  return `${kopfzeile("Nur für die Kassenführung", "Verwaltung")}
  <p class="leise klein">Bereich antippen zum Öffnen. Alle Einstellungen speicherst du gemeinsam mit dem Knopf unten im Bereich „Einstellungen“.</p>
  ${bereich("Helfer-Übersicht", "Wer hat wie oft geholfen, Namen zuordnen", helferUebersicht())}
  ${bereich("Einstellungen", "Mannschaft, Training, Hallen, Catering, Zeitnehmer, Kasse, Galerie", einstellungen)}
  ${bereich("Kader", `${kader().length} Spieler`, kaderHtml)}
  ${bereich("Trainerteam", `${trainer.length} Trainer, Texte für die Mannschaftsseite`, trainerHtml)}
  ${bereich("Kalender-Abo", "Link erneuern, falls er weitergegeben wurde", `<p class="leise klein">Eltern abonnieren unter „Spiele“ einen Link mit allen Spielen und Terminen. Falls der Link an die falschen Leute geraten ist, hier einen neuen erzeugen. Danach müssen alle einmal neu abonnieren.</p>
    <button class="knopf zweit klein" data-aktion="kalender-link-neu">Neuen Kalender-Link erzeugen</button>`)}`;
}

function termineBereich() {
  const alle = [...(Z.termine || [])].sort((a, b) => (a.datum + (a.zeit || "")).localeCompare(b.datum + (b.zeit || "")));
  const k = alle.filter((t) => t.datum >= heute()), v = alle.filter((t) => t.datum < heute());
  const familien = kader().map((x) => x.vorname);
  const karte = (t) => {
    const ant = (Z.antworten || []).filter((a) => a.terminId === t.id);
    const zu = ant.filter((a) => a.kommt), ab = ant.filter((a) => !a.kommt);
    const zusatz = zu.reduce((n, a) => n + (a.personen || 0), 0);
    const kosten = t.kostenProPerson || 0;
    const meine = meinKind() ? ant.find((a) => a.familie === meinKind()) : null;
    const offenFam = familien.filter((f) => !ant.some((a) => a.familie === f));
    const bezahlt = zu.filter((a) => a.bezahlt).reduce((n, a) => n + (a.personen || 0) * kosten, 0);
    const erwartet = zusatz * kosten;
    const personenAuswahl = (wert) => Array.from({ length: 9 }, (_, i) => `<option value="${i}" ${i === (wert ?? 0) ? "selected" : ""}>${i}</option>`).join("");
    const eigene = meinKind() ? `<div class="antwort-box">
        ${meine ? `<p class="gut" style="margin:0 0 8px">${meine.kommt ? `✓ Ihr seid dabei${meine.personen ? `, mit ${meine.personen} zusätzlichen ${meine.personen === 1 ? "Person" : "Personen"}` : ""}.` : "Ihr habt abgesagt."}${meine.kommt && kosten && meine.personen ? ` <span class="leise">Kosten für euch: ${euro(meine.personen * kosten)}${meine.bezahlt ? " · bezahlt ✓" : ""}</span>` : ""}</p>` : `<p style="margin:0 0 8px"><strong>Familie von ${esc(meinKind())}:</strong> Seid ihr dabei?</p>`}
        <form class="zeile" data-form="antwort" data-termin="${t.id}">
          <div class="feld" style="flex-basis:100%"><label>${esc(t.frage || "Wie viele zusätzliche Personen kommen mit?")}</label>
            <select name="personen">${personenAuswahl(meine?.personen)}</select></div>
          <button class="knopf">${meine ? "Ändern: wir kommen" : "Wir kommen"}</button>
          <button type="button" class="knopf zweit" data-aktion="antwort-absage" data-termin="${t.id}">Wir können nicht</button>
        </form>
        ${kosten ? `<p class="leise klein" style="margin:8px 0 0">${euro(kosten)} pro zusätzlicher Person. Spieler und Trainer sind frei.</p>` : ""}
      </div>`
      : `<p class="hinweis">Bitte zuerst deinen Sohn auswählen, dann kannst du für eure Familie zu- oder absagen. <button class="link-knopf" data-aktion="name-aendern">Jetzt auswählen</button></p>`;
    const verwaltung = istTrainer() ? `<details class="abstand"><summary>Verwalten und bearbeiten (${ant.length} von ${familien.length} Rückmeldungen)</summary>
        <p class="leise klein">Zu- und Absagen aus WhatsApp kannst du hier für jede Familie eintragen.</p>
        <div class="tabelle-wrap"><table class="antwort-tabelle">
          <thead><tr><th>Familie</th><th>Dabei?</th><th>+ Pers.</th>${kosten ? `<th class="betrag">Betrag</th><th>Bezahlt</th>` : ""}</tr></thead>
          <tbody>${familien.map((f) => {
            const a = ant.find((x) => x.familie === f);
            const betrag = a && a.kommt ? (a.personen || 0) * kosten : 0;
            return `<tr>
              <td>${esc(f)}</td>
              <td><select data-aktion="antwort-admin" data-termin="${t.id}" data-familie="${esc(f)}" data-feld="kommt">
                <option value="" ${!a ? "selected" : ""}>offen</option><option value="ja" ${a && a.kommt ? "selected" : ""}>ja</option><option value="nein" ${a && !a.kommt ? "selected" : ""}>nein</option></select></td>
              <td><select data-aktion="antwort-admin" data-termin="${t.id}" data-familie="${esc(f)}" data-feld="personen" ${a && a.kommt ? "" : "disabled"}>${personenAuswahl(a?.personen)}</select></td>
              ${kosten ? `<td class="betrag">${betrag ? euro(betrag) : "–"}</td>
              <td>${!istAdmin() ? (a && a.bezahlt ? "✓" : "") : betrag ? (a.bezahlt ? `✓ <button class="link-knopf" data-aktion="antwort-bezahlt" data-termin="${t.id}" data-familie="${esc(f)}" data-wert="nein">zurück</button>` : `<button class="knopf klein" data-aktion="antwort-buchen" data-termin="${t.id}" data-familie="${esc(f)}">bezahlt + buchen</button>`) : ""}</td>` : ""}
            </tr>`;
          }).join("")}</tbody></table></div>
        ${kosten ? `<p class="abstand"><strong>Eingegangen:</strong> ${euro(bezahlt)} von ${euro(erwartet)}</p>` : ""}
        <h3 class="abstand">Termin bearbeiten</h3>
        ${terminFormular(t)}
        <button class="knopf klein gefahr abstand" data-aktion="loeschen" data-col="termine" data-id="${t.id}" data-frage="Termin mit allen Rückmeldungen löschen?">Termin löschen</button>
      </details>` : "";
    return `<section class="karte termin-karte">
      <div class="spiel">${datumBlock(t.datum)}<div>
        <div class="spiel-titel">${esc(t.titel)}</div>
        <div class="leise">${t.zeit ? esc(t.zeit) + " Uhr" : ""}${t.ort ? " · " + esc(t.ort) : ""}</div></div></div>
      ${t.beschreibung ? `<div class="termin-text">${esc(t.beschreibung).replace(/\n/g, "<br>")}</div>` : ""}
      <div class="termin-stand">
        <span class="pill ok">${zu.length} dabei</span> <span class="pill neutral">${ab.length} abgesagt</span> <span class="pill offen">${offenFam.length} offen</span>
        <span class="leise">· ${zusatz} zusätzliche Personen</span>
      </div>
      ${t.frist && t.datum >= heute() ? `<p class="frist ${t.frist < heute() ? "vorbei" : fristBald(t.frist) ? "bald" : ""}">${t.frist < heute() ? `Rückmeldefrist war der ${kurzDatum(t.frist)}. Nachzügler bitte trotzdem eintragen.` : `Bitte bis <strong>${wochentagKurz(t.frist)} ${kurzDatum(t.frist)}</strong> zurückmelden.`}</p>` : ""}
      ${t.datum >= heute() ? eigene : ""}
      ${verwaltung}
    </section>`;
  };
  return `${k.map((t, i) => `<div class="${i ? "abstand" : ""}">${karte(t)}</div>`).join("")}
  ${!k.length && istTrainer() ? `<p class="leer">Gerade steht kein Termin an.</p>` : ""}
  ${v.length ? `<details class="abstand"><summary>Vergangene Termine (${v.length})</summary><div class="abstand">${[...v].reverse().map(karte).join("")}</div></details>` : ""}
  ${istTrainer() ? `<details class="karte abstand formular-klappe"><summary>Neuen Termin anlegen</summary><div class="abstand">${terminFormular(null)}</div></details>` : ""}`;
}

function terminFormular(t) {
  return `<form class="zeile" data-form="termin" ${t ? `data-id="${t.id}"` : ""}>
    <div class="feld" style="flex-basis:220px"><label>Titel</label><input type="text" name="titel" required maxlength="80" value="${esc(t?.titel || "")}"></div>
    <div class="feld" style="flex-basis:150px"><label>Datum</label><input type="date" name="datum" required value="${esc(t?.datum || "")}"></div>
    <div class="feld" style="flex-basis:110px"><label>Uhrzeit</label><input type="time" name="zeit" value="${esc(t?.zeit || "")}"></div>
    <div class="feld" style="flex-basis:200px"><label>Ort</label><input type="text" name="ort" maxlength="120" value="${esc(t?.ort || "")}"></div>
    <div class="feld" style="flex-basis:100%"><label>Beschreibung</label><textarea name="beschreibung" maxlength="2000">${esc(t?.beschreibung || "")}</textarea></div>
    <div class="feld" style="flex-basis:160px"><label>Rückmeldung bis</label><input type="date" name="frist" value="${esc(t?.frist || "")}"></div>
    <div class="feld" style="flex-basis:160px"><label>Kosten je zusätzl. Person (€)</label><input type="text" inputmode="decimal" name="kosten" value="${t?.kostenProPerson ? (t.kostenProPerson / 100).toFixed(2).replace(".", ",") : ""}" placeholder="0,00"></div>
    <div class="feld" style="flex-basis:300px"><label>Frage an die Eltern</label><input type="text" name="frage" maxlength="160" value="${esc(t?.frage || "Wie viele zusätzliche Personen (Eltern, Geschwister) kommen mit?")}"></div>
    <button class="knopf">${t ? "Speichern" : "Termin anlegen"}</button>
  </form>`;
}

// ---------- Helfer-Übersicht (nur Kasse) ----------
const familieAusName = (name) => { const m = /\(([^()]+)\)\s*$/.exec(name || ""); return m ? m[1].trim() : null; };
function helferUebersicht() {
  const namen = kader().map((k) => k.vorname);
  const zeilen = Object.fromEntries(namen.map((n) => [n, { standdienst: 0, mitgebracht: 0, gefahren: 0, zeitnehmer: 0, waesche: 0, trikots: 0 }]));
  const ohne = {};
  const zuordnung = Z.einstellungen.namenZuordnung || {};
  const zaehle = (name, feld) => {
    const n = (name || "?").trim();
    const f = zuordnung[n.toLowerCase()] || familieAusName(n);
    if (f === "-" || f === "Trainer") return;
    if (f && zeilen[f]) zeilen[f][feld]++;
    else ohne[n] = (ohne[n] || 0) + 1;
  };
  Z.standdienst.filter((x) => !x.reserve).forEach((x) => zaehle(x.name, "standdienst"));
  Z.catering.forEach((x) => zaehle(x.name, "mitgebracht"));
  Z.fahrten.forEach((x) => zaehle(x.fahrer, "gefahren"));
  (Z.zeitnehmer || []).forEach((x) => zaehle(x.name, "zeitnehmer"));
  (Z.waschdienst || []).forEach((x) => zaehle(x.name, "waesche"));
  trikotPlan().filter((p) => p.erledigt).forEach((p) => { const f = p.familie.replace(/^Familie von /, ""); if (zeilen[f]) zeilen[f].trikots++; });
  const summe = (z) => z.standdienst + z.mitgebracht + z.gefahren + z.zeitnehmer + z.waesche + z.trikots;
  const liste = namen.map((n) => ({ n, z: zeilen[n], s: summe(zeilen[n]) })).sort((a, b) => a.s - b.s || a.n.localeCompare(b.n, "de"));
  return `<section>
    <p class="leise klein">Nur für die Kassenführung sichtbar. Gezählt wird über den Namen in Klammern, z. B. „Peggy (Piet)“. Oben stehen die Familien, die bisher am wenigsten gemacht haben.</p>
    <div class="tabelle-wrap"><table class="helfer-tabelle">
      <thead><tr><th>Familie</th><th>Stand&shy;dienst</th><th>Mit&shy;gebracht</th><th>Gefahren</th><th>Zeit&shy;nehmer</th><th>Wäsche</th><th>Trikots</th><th>Gesamt</th></tr></thead>
      <tbody>${liste.map(({ n, z, s }) => `<tr class="${s === 0 ? "null" : ""}"><td>${esc(n)}</td><td>${z.standdienst}</td><td>${z.mitgebracht}</td><td>${z.gefahren}</td><td>${z.zeitnehmer}</td><td>${z.waesche}</td><td>${z.trikots}</td><td><strong>${s}</strong></td></tr>`).join("")}</tbody>
    </table></div>
    ${Object.keys(ohne).length ? `<h3 class="abstand">Ohne Zuordnung</h3>
      <p class="leise klein">Diese Einträge haben keinen Sohn in Klammern. Einmal zuordnen, dann zählen auch alle künftigen Einträge mit diesem Namen. Mehrere Elternteile können zum selben Sohn gehören.</p>
      <ul class="liste zuordnung-liste">${Object.entries(ohne).sort((a, b) => a[0].localeCompare(b[0], "de")).map(([n, c]) => `<li><span><strong>${esc(n)}</strong> <span class="leise">(${c}×)</span></span>
        <select data-aktion="name-zuordnen" data-name="${esc(n)}"><option value="">Sohn wählen …</option>${namen.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}<option value="-">nicht mitzählen (z. B. Trainer)</option></select></li>`).join("")}</ul>` : ""}
    ${Object.keys(zuordnung).length ? `<details class="abstand"><summary>Zugeordnete Namen (${Object.keys(zuordnung).length})</summary>
      <ul class="liste zuordnung-liste">${Object.entries(zuordnung).sort((a, b) => a[0].localeCompare(b[0], "de")).map(([n, f]) => `<li><span>${esc(n.replace(/(^|[\s(-])\S/g, (c) => c.toUpperCase()))}</span>
        <select data-aktion="name-zuordnen" data-name="${esc(n)}">${namen.map((k) => `<option value="${esc(k)}" ${k === f ? "selected" : ""}>${esc(k)}</option>`).join("")}<option value="-" ${f === "-" ? "selected" : ""}>nicht mitzählen</option><option value="__loesen">Zuordnung lösen</option></select></li>`).join("")}</ul></details>` : ""}
    <details class="abstand"><summary>Einen Namen von Hand zuordnen</summary>
      <p class="leise klein">Für Einträge mit falschem oder fehlendem Sohn, z. B. „René“ oder „Anja (Max)“ statt „Anja (Mats)“. Gilt für alle Einträge mit genau diesem Namen.</p>
      <form class="zeile" data-form="name-zuordnen">
        <div class="feld" style="flex-basis:220px"><label>Name wie eingetragen</label><input type="text" name="name" required maxlength="80" list="alle-namen">
          <datalist id="alle-namen">${[...new Set([...Z.standdienst, ...Z.catering, ...(Z.zeitnehmer || []), ...(Z.waschdienst || [])].map((x) => x.name).concat(Z.fahrten.map((x) => x.fahrer)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")).map((x) => `<option value="${esc(x)}">`).join("")}</datalist></div>
        <div class="feld" style="flex-basis:160px"><label>Sohn</label><select name="sohn">${namen.map((k) => `<option>${esc(k)}</option>`).join("")}<option value="-">nicht mitzählen</option></select></div>
        <button class="knopf">Zuordnen</button>
      </form></details>
  </section>`;
}

// ---------- Infos vom Trainerteam und Abfragen ----------
const aktiveHinweise = () => (Z.hinweise || []).filter((h) => !h.bis || h.bis >= heute()).sort((a, b) => (b.erstellt || "").localeCompare(a.erstellt || ""));
const abfrageOptionen = (a) => (a.optionen || "").split("\n").map((x) => x.trim()).filter(Boolean);
const abfrageOffen = (a) => !a.geschlossen && (!a.frist || a.frist >= heute());
const abfrageAntwort = (a, spieler) => (Z.abfrageAntworten || []).find((x) => x.abfrageId === a.id && x.spieler === spieler);
const offeneAbfragenFuerMich = () => meinKind() ? (Z.abfragen || []).filter((a) => abfrageOffen(a) && !abfrageAntwort(a, meinKind())) : [];
const fristBald = (iso) => iso && iso >= heute() && (datum(iso) - datum(heute())) / 864e5 <= 3;
const wochentagKurz = (iso) => datum(iso).toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "") + ".";
// offene Rückmeldungen (Termine und Abfragen) für Hinweise und WhatsApp
function offeneRueckmeldungen() {
  const n = kader().length;
  const termine = (Z.termine || []).filter((t) => t.datum >= heute() && (datum(t.datum) - datum(heute())) / 864e5 <= 60)
    .map((t) => ({ art: "termin", titel: t.titel, datum: t.datum, frist: t.frist, offen: n - new Set((Z.antworten || []).filter((a) => a.terminId === t.id).map((a) => a.familie)).size, meins: !!(meinKind() && (Z.antworten || []).some((a) => a.terminId === t.id && a.familie === meinKind())) }));
  const abfragen = (Z.abfragen || []).filter(abfrageOffen)
    .map((a) => ({ art: "abfrage", titel: a.titel, frist: a.frist, offen: n - new Set((Z.abfrageAntworten || []).filter((x) => x.abfrageId === a.id).map((x) => x.spieler)).size, meins: !!(meinKind() && abfrageAntwort(a, meinKind())) }));
  return [...termine, ...abfragen].filter((x) => x.offen > 0);
}
const kurzDatum = (iso) => datum(iso).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" });

function hinweiseKarte(nurStart = false) {
  const h = aktiveHinweise();
  if (!h.length) return nurStart ? "" : `<p class="leer">Gerade gibt es keine Infos vom Trainerteam.</p>`;
  return `<ul class="hinweis-liste">${(nurStart ? h.slice(0, 3) : h).map((x) => `<li>
      <div class="hinweis-text">${esc(x.text).replace(/\n/g, "<br>")}</div>
      <div class="leise klein">${x.von ? esc(x.von) + " · " : ""}${kurzDatum((x.erstellt || heute()).slice(0, 10))}${x.bis ? ` · gilt bis ${kurzDatum(x.bis)}` : ""}
</div>
      ${istTrainer() && !nurStart ? `<details class="bearbeiten"><summary>bearbeiten</summary>
        <form data-form="hinweis-edit" data-id="${x.id}">
          <div class="feld"><textarea name="text" required maxlength="600">${esc(x.text)}</textarea></div>
          <div class="zeile"><div class="feld" style="flex-basis:160px"><label>Anzeigen bis</label><input type="date" name="bis" value="${esc(x.bis || "")}"></div>
          <button class="knopf klein">Speichern</button>
          <button type="button" class="link-knopf gefahr-text" data-aktion="loeschen" data-col="hinweise" data-id="${x.id}" data-frage="Info löschen?">löschen</button></div>
        </form></details>` : ""}
    </li>`).join("")}</ul>${nurStart && h.length > 3 ? `<p class="klein"><a href="#/infos">Alle Infos ›</a></p>` : ""}`;
}

function antwortText(a, x) {
  if (!x) return "";
  const opt = abfrageOptionen(a);
  if (!opt.length) return x.gewaehlt === "ja" ? "Ja" : "Nein";
  const idx = (x.gewaehlt || "").split(",").filter((i) => i !== "" && i !== "keiner").map(Number);
  return idx.length ? idx.map((i) => opt[i]).filter(Boolean).join(", ") : "An keinem Termin";
}

function abfrageKarte(a) {
  const opt = abfrageOptionen(a);
  const spieler = kader().map((k) => k.vorname);
  const antworten = (Z.abfrageAntworten || []).filter((x) => x.abfrageId === a.id);
  const offen = abfrageOffen(a);
  const fehlt = spieler.filter((n) => !antworten.some((x) => x.spieler === n));
  const meine = meinKind() ? abfrageAntwort(a, meinKind()) : null;
  const gewaehlt = new Set((meine?.gewaehlt || "").split(","));
  const formular = !offen ? "" : meinKind() ? `<div class="antwort-box">
      ${meine ? `<p class="gut" style="margin:0 0 8px">✓ Antwort für ${esc(meinKind())}: ${esc(antwortText(a, meine))}</p>` : `<p style="margin:0 0 8px"><strong>Antwort für ${esc(meinKind())}</strong></p>`}
      <form data-form="abfrage" data-id="${a.id}">
        ${opt.length ? `<div class="optionen">${opt.map((o, i) => `<label class="option"><input type="checkbox" name="o" value="${i}" ${gewaehlt.has(String(i)) ? "checked" : ""}> <span>${esc(o)}</span></label>`).join("")}</div>`
          : `<div class="optionen"><label class="option"><input type="radio" name="o" value="ja" ${meine?.gewaehlt === "ja" ? "checked" : ""} required> <span>Ja, ist dabei</span></label><label class="option"><input type="radio" name="o" value="nein" ${meine?.gewaehlt === "nein" ? "checked" : ""}> <span>Nein</span></label></div>`}
        <input type="text" name="bemerkung" maxlength="200" placeholder="Bemerkung (optional)" value="${esc(meine?.bemerkung || "")}" aria-label="Bemerkung">
        <div class="ausrichten" style="margin-top:10px"><button class="knopf">${meine ? "Antwort ändern" : "Antwort senden"}</button>
          ${opt.length ? `<span class="leise klein">Nichts angekreuzt heißt: an keinem Termin.</span>` : ""}</div>
      </form></div>`
    : `<p class="hinweis">Bitte zuerst deinen Sohn auswählen, dann kannst du antworten. <button class="link-knopf" data-aktion="name-aendern">Jetzt auswählen</button></p>`;
  const spalten = opt.length ? opt : ["Dabei"];
  const zelle = (n, i) => {
    const x = antworten.find((y) => y.spieler === n);
    const an = x && (opt.length ? (x.gewaehlt || "").split(",").includes(String(i)) : x.gewaehlt === "ja");
    const inhalt = !x ? `<span class="leise">–</span>` : an ? "✓" : `<span class="leise">✗</span>`;
    return istTrainer() && offen ? `<td><button class="zelle ${an ? "an" : ""}" data-aktion="abfrage-zelle" data-id="${a.id}" data-spieler="${esc(n)}" data-index="${opt.length ? i : "ja"}">${inhalt}</button></td>` : `<td>${inhalt}</td>`;
  };
  const summe = (i) => antworten.filter((x) => opt.length ? (x.gewaehlt || "").split(",").includes(String(i)) : x.gewaehlt === "ja").length;
  const uebersicht = `<details class="abstand" ${istTrainer() ? "open" : ""}><summary>Übersicht (${antworten.length} von ${spieler.length} geantwortet)</summary>
      ${istTrainer() && offen ? `<p class="leise klein">Antworten aus WhatsApp kannst du direkt in der Tabelle antippen.</p>` : ""}
      <div class="tabelle-wrap"><table class="abfrage-tabelle">
        <thead><tr><th>Spieler</th>${spalten.map((o) => `<th>${esc(o)}</th>`).join("")}<th>Bemerkung</th></tr></thead>
        <tbody>${spieler.map((n) => { const x = antworten.find((y) => y.spieler === n); return `<tr><td>${esc(n)}</td>${spalten.map((_, i) => zelle(n, i)).join("")}<td class="klein">${esc(x?.bemerkung || "")}</td></tr>`; }).join("")}</tbody>
        <tfoot><tr><th>Summe</th>${spalten.map((_, i) => `<th>${summe(i)}</th>`).join("")}<th></th></tr></tfoot>
      </table></div>
      ${fehlt.length ? `<p class="klein abstand"><strong>Noch keine Antwort:</strong> ${esc(fehlt.join(", "))}</p>` : `<p class="gut klein abstand">Alle haben geantwortet.</p>`}
      ${istTrainer() ? `<details class="bearbeiten abstand"><summary>Abfrage bearbeiten</summary>
        <form data-form="abfrage-edit" data-id="${a.id}">
          <div class="feld"><label>Frage</label><input type="text" name="titel" required maxlength="120" value="${esc(a.titel)}"></div>
          <div class="feld"><label>Erklärung</label><textarea name="text" maxlength="800">${esc(a.text || "")}</textarea></div>
          <div class="feld"><label>Termine zum Ankreuzen, einer pro Zeile</label><textarea name="optionen" maxlength="600">${esc(a.optionen || "")}</textarea>
            ${antworten.length && opt.length ? `<p class="leise klein">Es gibt schon Antworten. Termine bitte nur umbenennen oder unten ergänzen, nicht umsortieren oder löschen, sonst verrutschen die Kreuze.</p>` : ""}</div>
          <div class="zeile"><div class="feld" style="flex-basis:160px"><label>Antworten bis</label><input type="date" name="frist" value="${esc(a.frist || "")}"></div>
          <button class="knopf klein">Speichern</button></div>
        </form></details>
      <div class="ausrichten abstand">
        <button class="knopf zweit klein" data-aktion="abfrage-schliessen" data-id="${a.id}" data-wert="${a.geschlossen ? "nein" : "ja"}">${a.geschlossen ? "Wieder öffnen" : "Abfrage beenden"}</button>
        <button class="link-knopf gefahr-text" data-aktion="loeschen" data-col="abfragen" data-id="${a.id}" data-frage="Abfrage mit allen Antworten löschen?">löschen</button></div>` : ""}
    </details>`;
  return `<section class="karte abfrage-karte">
    <div class="karte-kopf"><h2 style="margin:0">${esc(a.titel)}</h2>${offen ? (a.frist ? `<span class="pill offen">bis ${kurzDatum(a.frist)}</span>` : "") : `<span class="pill neutral">beendet</span>`}</div>
    ${a.text ? `<p class="termin-text">${esc(a.text).replace(/\n/g, "<br>")}</p>` : ""}
    ${a.von ? `<p class="leise klein" style="margin-top:-6px">von ${esc(a.von)}</p>` : ""}
    ${formular}
    ${uebersicht}
  </section>`;
}

function seiteInfos() {
  const abfragen = [...(Z.abfragen || [])].sort((a, b) => (b.erstellt || "").localeCompare(a.erstellt || ""));
  const aktuell = abfragen.filter((a) => abfrageOffen(a) || (a.frist || "9") >= heute());
  const alt = abfragen.filter((a) => !aktuell.includes(a));
  const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const termine = termineBereich();
  return `${kopfzeile("Trainerteam, Feiern, Abfragen", "Infos & Termine")}
  <section class="karte"><h2>Infos vom Trainerteam</h2>${hinweiseKarte()}
    ${istTrainer() ? `<details class="abstand"><summary>Neue Info schreiben</summary>
      <form data-form="hinweis">
        <div class="feld"><label>Text</label><textarea name="text" required maxlength="600" placeholder="z. B. Training am Freitag fällt aus, die Halle ist belegt."></textarea></div>
        <div class="zeile"><div class="feld" style="flex-basis:160px"><label>Anzeigen bis</label><input type="date" name="bis" value="${in14}"></div>
        <button class="knopf">Veröffentlichen</button></div>
      </form></details>` : ""}
  </section>
  ${termine.trim() ? `<h2 class="bereich-titel">Termine</h2>${termine}` : ""}
  ${aktuell.length || istTrainer() ? `<h2 class="bereich-titel">Abfragen</h2>` : ""}
  ${aktuell.map((a, i) => `<div class="${i ? "abstand" : ""}">${abfrageKarte(a)}</div>`).join("")}
  ${istTrainer() ? `<details class="karte abstand formular-klappe"><summary>Neue Abfrage starten</summary><div class="abstand">
      <p class="leise klein">Zum Beispiel: Wer ist in den Herbstferien beim Training? Die Eltern antworten für ihren Sohn, du siehst sofort die Übersicht.</p>
      <form data-form="abfrage-neu">
        <div class="feld"><label>Frage</label><input type="text" name="titel" required maxlength="120" placeholder="Training in den Herbstferien"></div>
        <div class="feld"><label>Erklärung (optional)</label><textarea name="text" maxlength="800"></textarea></div>
        <div class="feld"><label>Termine zum Ankreuzen, einer pro Zeile (leer lassen für eine Ja/Nein-Frage)</label><textarea name="optionen" maxlength="600" placeholder="Di 20.10. 17:30\nFr 23.10. 18:00\nDi 27.10. 17:30"></textarea></div>
        <div class="zeile"><div class="feld" style="flex-basis:160px"><label>Antworten bis</label><input type="date" name="frist"></div>
        <button class="knopf">Abfrage starten</button></div>
      </form></div></details>` : ""}
  ${alt.length ? `<details class="abstand"><summary>Frühere Abfragen (${alt.length})</summary>${alt.map((a) => `<div class="abstand">${abfrageKarte(a)}</div>`).join("")}</details>` : ""}`;
}

function seiteDatenschutz() {
  return `${kopfzeile("Kurz und klar", "Datenschutz")}
  <section class="karte">
    <p>Diese Seite ist ein privates Angebot der Eltern der männlichen C-Jugend des Ohligser TV 1888 e.V. Sie ist passwortgeschützt und nur für Eltern der Mannschaft gedacht. Suchmaschinen sind ausgeschlossen.</p>
    <h3>Welche Daten gespeichert werden</h3>
    <p>Namen und Angaben, die ihr selbst eintragt (Standdienst, Mitbringliste, Trikotplan, Fotos), die Buchungen der Mannschaftskasse sowie Vornamen der Spieler. Gespeichert wird bei Netlify (Netlify, Inc.). Für die Anmeldung wird ein technisch notwendiges Cookie gesetzt. Euer Browser merkt sich lokal eine zufällige Gerätekennung und euren zuletzt eingetragenen Namen, damit ihr eigene Einträge wieder entfernen könnt.</p>
    <h3>Fotos</h3>
    <p>Fotos werden nur mit Einverständnis der abgebildeten Personen beziehungsweise ihrer Eltern hochgeladen. Wer ein Foto entfernt haben möchte, nutzt in der Galerie „Melden“. Das Foto wird sofort ausgeblendet und von der Kassenführung geprüft.</p>
    <h3>handball.net</h3>
    <p>Diese Webseite bindet Widgets von handball.net (www.handball.net) ein. Der Browser ruft direkt die Server von handball.net auf. Handball.net erstellt anonymisierte Aufrufstatistiken und speichert alle Zugriffe für maximal 3 Monate.</p>
    <h3>Ansprechpartner</h3>
    <p>Fragen und Löschwünsche an die Kassenführung über die Eltern-WhatsApp-Gruppe.</p>
  </section>`;
}


// ---------- Bausteine ----------
const wtDatum = (s) => datum(s.datum).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const namenListe = (arr) => [...new Set(arr)].join(", ");

// Teilen-Fenster: Text kopieren oder direkt in WhatsApp öffnen
function teilen(text) {
  const box = document.createElement("div");
  box.className = "lightbox";
  box.setAttribute("role", "dialog");
  box.innerHTML = `<div class="teilen-box">
    <h2 style="margin-bottom:8px">Text für WhatsApp</h2>
    <textarea readonly>${esc(text)}</textarea>
    <div class="ausrichten abstand" style="margin-top:12px">
      <button class="knopf" data-t="kopieren">Kopieren</button>
      <a class="knopf zweit" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">In WhatsApp öffnen</a>
      <button class="knopf zweit" data-t="zu">Schließen</button>
    </div></div>`;
  box.addEventListener("click", async (e) => {
    if (e.target === box || e.target.dataset.t === "zu") return box.remove();
    if (e.target.dataset.t === "kopieren") {
      try { await navigator.clipboard.writeText(text); }
      catch { const t = box.querySelector("textarea"); t.select(); document.execCommand("copy"); }
      meldung("Text kopiert, jetzt in die WhatsApp-Gruppe einfügen");
    }
  });
  document.body.appendChild(box);
}

function cateringText(s) {
  const e = Z.einstellungen;
  const alle = Z.standdienst.filter((x) => x.spielId === s.id).sort((a, b) => a.erstellt.localeCompare(b.erstellt));
  const dienst = alle.filter((x) => !x.reserve).map((x) => anzeigeName(x.name));
  const reserve = alle.filter((x) => x.reserve).map((x) => anzeigeName(x.name));
  const frei = Math.max(0, e.standdienstPlaetze - dienst.length);
  const z = [`🤾 Heimspiel ${wtDatum(s)}${s.zeit ? " " + s.zeit + " Uhr" : ""} gegen ${s.gegner}`];
  if (s.halle) z.push(`📍 ${s.halle}`);
  z.push("", `👕 Standdienst${treffzeit(s) ? ` (bitte spätestens um ${treffzeit(s)} Uhr da sein)` : ""}:`);
  z.push(dienst.length ? `${frei ? "" : "✅ "}${dienst.join(", ")}` : "");
  if (frei) z.push(`❗ noch ${frei} ${frei === 1 ? "Platz" : "Plätze"} frei`);
  if ((e.reservePlaetze ?? 1) > 0) z.push(reserve.length ? `Reserve: ${reserve.join(", ")}` : "Reserve: noch frei");
  if (zeitnehmerNoetig(s)) z.push(`⏱ Zeitnehmer: ${zeitnehmerVon(s).map((x) => anzeigeName(x.name)).join(", ") || "❗ noch offen"}`);
  if (waescheNoetig(s)) {
    const vor = vorherigesHeim(s), bringt = vor && waescheVon(vor);
    if (bringt) z.push(`🧺 Wäsche bringt mit: ${bringt.name}`);
    z.push(`🧺 Wäsche nach dem Spiel mitnehmen: ${waescheVon(s)?.name || "❗ noch offen"}`);
  }
  z.push("", "🍰 Mitbringliste:");
  for (const a of cateringStatus(s).artikel) {
    const zus = Z.catering.filter((c) => c.spielId === s.id && c.artikel === a.name);
    const wer = zus.map((c) => (c.menge ? `${c.menge} von ` : "") + anzeigeName(c.name)).join(", ");
    const fehlt = a.bedarf - zus.length;
    const name = a.hinweis ? `${a.name} (je ${a.hinweis})` : a.name;
    z.push(fehlt > 0 ? `❗ ${name}: ${wer ? wer + ", " : ""}noch ${fehlt} gesucht` : `✅ ${a.name}: ${wer}`);
  }
  z.push("", `Eintragen: ${location.origin}/#/catering`);
  return z.filter((x, i, arr) => !(x === "" && arr[i - 1] === "")).join("\n").replace(/Standdienst:\n\n/, "Standdienst:\n");
}

// ---------- Kasse: Ergebnis je Heimspiel ----------
function spielBilanz(spielId) {
  const b = Z.kasse.filter((x) => x.spielId === spielId);
  const ein = b.filter((x) => x.art === "einnahme");
  const aus = b.filter((x) => x.art === "ausgabe");
  const summe = (l) => l.reduce((t, x) => t + x.betrag, 0);
  const nach = (l, feld) => {
    const m = new Map();
    l.forEach((x) => m.set(x[feld] || "Sonstiges", (m.get(x[feld] || "Sonstiges") || 0) + x.betrag));
    return [...m.entries()];
  };
  return { anzahl: b.length, ein: summe(ein), aus: summe(aus), einNach: nach(ein, "kanal"), ausNach: nach(aus, "kategorie") };
}

function spielErgebnisse() {
  const zeilen = heimspiele().map((s) => ({ s, b: spielBilanz(s.id) })).filter((x) => x.b.anzahl);
  if (!zeilen.length) return "";
  return `<section class="karte abstand">
    <h2>Ergebnis je Heimspiel</h2>
    <div class="tabelle-wrap"><table>
      <thead><tr><th>Heimspiel</th><th class="betrag">Einnahmen</th><th class="betrag">Ausgaben</th><th class="betrag">Ergebnis</th><th></th></tr></thead>
      <tbody>${zeilen.reverse().map(({ s, b }) => `<tr>
        <td><strong>${wtDatum(s)}</strong> <span class="leise">gegen ${esc(s.gegner)}</span></td>
        <td class="betrag plus">${euro(b.ein)}</td>
        <td class="betrag minus">${euro(b.aus)}</td>
        <td class="betrag"><strong>${euro(b.ein - b.aus)}</strong></td>
        <td style="text-align:right"><button class="link-knopf" data-aktion="whatsapp-abrechnung" data-spiel="${s.id}">teilen</button></td>
      </tr>`).join("")}</tbody></table></div>
  </section>`;
}

function abrechnungsFormular() {
  const e = Z.einstellungen;
  const liste = heimspiele();
  const vorschlag = [...vergangene(liste)].reverse().find((s) => !spielBilanz(s.id).anzahl) || kommende(liste)[0];
  const opt = (l, wert) => l.map((x) => `<option ${x === wert ? "selected" : ""}>${esc(x)}</option>`).join("");
  return `<details class="karte abstand nur-kasse formular-klappe"><summary>Heimspiel abrechnen</summary><div class="abstand">
    <p class="leise">Nach dem Spiel einmal ausfüllen. Daraus entstehen die Buchungen und ein fertiger Text für die Gruppe. Leere Felder werden übersprungen.</p>
    <form data-form="abrechnung">
      <div class="zeile">
        <div class="feld" style="flex-basis:260px"><label>Heimspiel</label><select name="spielId" required>${liste.map((s) => `<option value="${s.id}" ${vorschlag && s.id === vorschlag.id ? "selected" : ""}>${wtDatum(s)} gegen ${esc(s.gegner)}</option>`).join("")}</select></div>
      </div>
      <h3 class="abstand">Einnahmen</h3>
      <div class="zeile">${e.kassenKanaele.map((k) => `<div class="feld" style="flex-basis:130px"><label>${esc(k)} (€)</label><input type="text" inputmode="decimal" name="ein:${esc(k)}" placeholder="0,00"></div>`).join("")}</div>
      <h3 class="abstand">Ausgaben</h3>
      <div class="zeile">
        <div class="feld" style="flex-basis:150px"><label>Getränke OTV (€)</label><input type="text" inputmode="decimal" name="getraenke" placeholder="0,00"></div>
        <div class="feld" style="flex-basis:130px"><label>bezahlt per</label><select name="getraenkeKanal">${opt(e.kassenKanaele, "Bar")}</select></div>
        <div class="feld" style="flex-basis:150px"><label>Einkauf Catering (€)</label><input type="text" inputmode="decimal" name="einkauf" placeholder="0,00"></div>
        <div class="feld" style="flex-basis:130px"><label>bezahlt per</label><select name="einkaufKanal">${opt(e.kassenKanaele, "Bar")}</select></div>
        <div class="feld" style="flex-basis:200px"><label>Beleg / Notiz</label><input type="text" name="beleg" maxlength="120" placeholder="optional"></div>
      </div>
      <button class="knopf abstand">Abrechnung speichern</button>
    </form></div>
  </details>`;
}

function abrechnungsText(spielId) {
  const s = Z.spiele.find((x) => x.id === spielId);
  const b = spielBilanz(spielId);
  const z = [`💰 Abrechnung Heimspiel gegen ${s.gegner} (${wtDatum(s)})`, ""];
  z.push(`Einnahmen: ${euro(b.ein)}${b.einNach.length > 1 ? " (" + b.einNach.map(([k, v]) => `${k} ${euro(v)}`).join(", ") + ")" : ""}`);
  if (b.aus) z.push(`Ausgaben: ${euro(b.aus)} (${b.ausNach.map(([k, v]) => `${k} ${euro(v)}`).join(", ")})`);
  z.push(`Ergebnis: ${b.ein - b.aus >= 0 ? "+" : "−"}${euro(Math.abs(b.ein - b.aus))}`);
  z.push(`Kassenstand jetzt: ${euro(kassenSummen().saldo)}`);
  const helfer = Z.standdienst.filter((x) => x.spielId === spielId).map((x) => x.name);
  const backen = Z.catering.filter((x) => x.spielId === spielId).map((x) => x.name);
  if (helfer.length || backen.length) z.push("");
  if (helfer.length) z.push(`Danke an den Standdienst: ${namenListe(helfer)} 🙌`);
  if (backen.length) z.push(`Danke fürs Mitbringen: ${namenListe(backen)} 🍰`);
  z.push("", `Details: ${location.origin}/#/kasse`);
  return z.join("\n");
}

// ---------- Fahrgemeinschaften ----------
const auswaertsspiele = () => spieleSortiert().filter((s) => !s.heim);

function fahrtStatus(s) {
  const fahrten = Z.fahrten.filter((f) => f.spielId === s.id);
  const plaetze = fahrten.reduce((t, f) => t + f.plaetze, 0);
  const belegt = Z.mitfahrer.filter((m) => fahrten.some((f) => f.id === m.fahrtId)).length;
  return { fahrten, plaetze, belegt, frei: plaetze - belegt };
}

function fahrtKachel() {
  const s = kommende(auswaertsspiele())[0];
  if (!s) return "";
  const st = fahrtStatus(s);
  return `<section class="karte"><div class="kachel-label">Nächste Auswärtsfahrt</div>
    ${spielZeile(s)}
    ${hallenZeile(s)}
    <p class="abstand" style="margin-bottom:4px"><strong>${st.fahrten.length ? `${st.fahrten.length} Fahrer, ${st.frei} ${st.frei === 1 ? "Platz" : "Plätze"} frei` : "Noch keine Fahrgemeinschaft"}</strong></p>
    <a class="knopf" href="#/fahrten">Mitfahren oder Plätze anbieten</a></section>`;
}

// "10:30" -> "10:30 Uhr" (nur wenn "Uhr" noch fehlt)
const mitUhr = (t) => String(t || "").replace(/\b(\d{1,2})[:.](\d{2})\b(?!\s*Uhr)/gi, "$1:$2 Uhr");
const abfahrtText = (t) => mitUhr(String(t || "").trim().replace(/^abfahrt:?\s*/i, ""));

function spielNachricht(sp) {
  const z = [];
  // 1. Infos vom Trainerteam
  const infos = aktiveHinweise();
  if (infos.length) {
    z.push("📣 *Info vom Trainerteam*");
    for (const h of infos) z.push(h.text.trim());
    z.push("");
  }
  // 2. Kopf: Spiel, Tag, Anwurf, Treffen, Halle
  const tag = datum(sp.datum).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  const tz = treffzeit(sp);
  const adr = halleAdresse(sp.halle);
  const halle = [sp.halle, adr && !(sp.halle || "").includes(adr) ? adr : ""].filter(Boolean).join(", ");
  z.push(sp.heim ? `🏠 *Heimspiel gegen ${sp.gegner}*` : `🚗 *Auswärtsspiel bei ${sp.gegner}*`);
  z.push(`${tag}${sp.zeit ? ` · Anwurf ${sp.zeit} Uhr` : ""}`);
  if (tz) z.push(`Jungs${sp.heim ? " und Standdienst" : ""} um ${tz} Uhr in der Halle`);
  z.push(`Halle: ${halle || "folgt"}`);
  // 3. Was fehlt, was steht
  const fehlt = [], steht = [];
  if (sp.heim) {
    const st = cateringStatus(sp);
    const dienst = Z.standdienst.filter((x) => x.spielId === sp.id && !x.reserve);
    const frei = st.plaetze - st.dienst;
    if (frei > 0) fehlt.push(`${frei}× Standdienst`);
    if (dienst.length) steht.push(`Standdienst: ${dienst.map((x) => anzeigeName(x.name)).join(", ")}`);
    const offen = st.artikel.filter((a) => a.zugesagt < a.bedarf);
    if (offen.length) fehlt.push(offen.map((a) => `${a.name}${a.bedarf - a.zugesagt > 1 ? ` (${a.bedarf - a.zugesagt}×)` : ""}`).join(", "));
    for (const a of st.artikel) {
      const zus = Z.catering.filter((c) => c.spielId === sp.id && c.artikel === a.name);
      if (zus.length) steht.push(`${a.name}: ${zus.map((c) => anzeigeName(c.name)).join(", ")}`);
    }
  } else {
    const st = fahrtStatus(sp);
    if (!st.fahrten.length) fehlt.push("Fahrer mit freien Plätzen");
    for (const f of st.fahrten) {
      const mit = Z.mitfahrer.filter((m) => m.fahrtId === f.id).map((m) => m.name);
      const frei = f.plaetze - mit.length;
      steht.push(`${anzeigeName(f.fahrer)} fährt: ${frei > 0 ? `${frei} ${frei === 1 ? "Platz" : "Plätze"} frei` : "voll"}${f.treffpunkt ? `, Abfahrt ${abfahrtText(f.treffpunkt)}` : ""}${mit.length ? `, dabei: ${mit.join(", ")}` : ""}`);
    }
  }
  if (zeitnehmerNoetig(sp)) {
    const zn = zeitnehmerVon(sp);
    if (zn.length < zeitnehmerPlaetze()) fehlt.push("Zeitnehmer");
    if (zn.length) steht.push(`Zeitnehmer: ${zn.map((x) => anzeigeName(x.name)).join(", ")}`);
  }
  if (waescheNoetig(sp)) {
    const w = waescheVon(sp);
    if (w) steht.push(`Wäsche danach: ${anzeigeName(w.name)}`); else fehlt.push("Wäsche nach dem Spiel mitnehmen");
  }
  if (fehlt.length) { z.push("", "❗ *Noch gesucht*"); for (const x of fehlt) z.push(`• ${x}`); }
  if (steht.length) { z.push("", "✅ *Schon eingetragen*"); for (const x of steht) z.push(`• ${x}`); }
  if (!fehlt.length) z.push("", "Alles besetzt, danke! 👍");
  // 4. Offene Rückmeldungen
  const rm = offeneRueckmeldungen();
  if (rm.length) {
    z.push("", "📅 *Bitte zurückmelden*");
    for (const x of rm) z.push(`• ${x.titel}${x.datum ? ` am ${kurzDatum(x.datum)}` : ""}${x.frist && x.frist >= heute() ? `, bis ${kurzDatum(x.frist)}` : ""} (${x.offen} ${x.offen === 1 ? "Familie fehlt" : "Familien fehlen"} noch)`);
  }
  z.push("", `👉 ${location.origin}`);
  return z.join("\n");
}

function fahrtenText(s) {
  const st = fahrtStatus(s);
  const z = [`🚗 Fahrgemeinschaften Auswärtsspiel ${wtDatum(s)}${s.zeit ? " " + s.zeit + " Uhr" : ""} bei ${s.gegner}`];
  if (s.halle) z.push(`📍 ${s.halle}`);
  if (treffzeit(s)) z.push(`⏰ Jungs spätestens um ${treffzeit(s)} Uhr in der Halle`);
  if (zeitnehmerNoetig(s)) z.push(`⏱ Zeitnehmer: ${zeitnehmerVon(s).map((x) => anzeigeName(x.name)).join(", ") || "❗ noch offen"}`);
  z.push("");
  if (!st.fahrten.length) z.push("❗ Bisher bietet noch niemand Plätze an.");
  for (const f of st.fahrten) {
    const mit = Z.mitfahrer.filter((m) => m.fahrtId === f.id).map((m) => m.name);
    const frei = f.plaetze - mit.length;
    z.push(`${anzeigeName(f.fahrer)}${f.treffpunkt ? " · " + f.treffpunkt : ""}: ${mit.length ? mit.join(", ") : "noch niemand"}${frei > 0 ? ` (noch ${frei} frei)` : " (voll)"}`);
  }
  z.push("", `Eintragen: ${location.origin}/#/fahrten`);
  return z.join("\n");
}

function fahrtenDetails(s) {
    const st = fahrtStatus(s);
    const vergeben = new Set(Z.mitfahrer.filter((m) => st.fahrten.some((f) => f.id === m.fahrtId)).map((m) => m.name));
    const kinder = kader().map((x) => x.vorname).filter((n) => !vergeben.has(n));
    const fahrten = st.fahrten.map((f) => {
      const mit = Z.mitfahrer.filter((m) => m.fahrtId === f.id).sort((a, b) => a.erstellt.localeCompare(b.erstellt));
      const frei = f.plaetze - mit.length;
      return `<li class="fahrt">
        <div class="fahrt-kopf">
          <div><strong>${esc(anzeigeName(f.fahrer))}</strong> <span class="pill ${frei > 0 ? "ok" : "neutral"}">${frei > 0 ? `${frei} von ${f.plaetze} frei` : "voll"}</span>
            ${f.treffpunkt ? `<div class="leise klein">Abfahrt: ${esc(abfahrtText(f.treffpunkt))}</div>` : ""}
            ${f.hinweis ? `<div class="leise klein">${esc(f.hinweis)}</div>` : ""}</div>
          ${darfLoeschen(f) ? `<button class="link-knopf" style="color:var(--rot)" data-aktion="loeschen" data-col="fahrten" data-id="${f.id}" data-frage="Fahrt löschen? Eingetragene Mitfahrer werden mit entfernt.">Fahrt löschen</button>` : ""}
        </div>
        <div>${mit.map((m) => `<span class="chip">${esc(m.name)}${darfLoeschen(m) ? `<button class="x" title="austragen" data-aktion="loeschen" data-col="mitfahrer" data-id="${m.id}" data-frage="${esc(m.name)} austragen?">×</button>` : `<span style="width:6px"></span>`}</span>`).join("")}</div>
        ${frei > 0 ? `<form class="zeile mitfahren" data-form="mitfahrer" data-fahrt="${f.id}">
          <div class="feld"><select name="name" aria-label="Spieler auswählen">${kinder.length ? `<option value="">Spieler auswählen …</option>${kinder.map((n) => `<option ${n === meinKind() ? "selected" : ""}>${esc(n)}</option>`).join("")}` : `<option value="">alle Jungs eingetragen</option>`}<option value="__andere">jemand anderes …</option></select></div>
          <button class="knopf klein">Mitfahren</button></form>` : ""}
      </li>`;
    }).join("");
  return `${fahrten ? `<ul class="liste">${fahrten}</ul>` : `<p class="leer">Noch bietet niemand Plätze an.</p>`}
        <details class="abstand fahrt-anbieten" id="anbieten-${s.id}"><summary>Ich fahre und habe Plätze frei</summary>
          <form class="zeile" data-form="fahrt" data-spiel="${s.id}">
            <div class="feld" style="flex-basis:110px"><label>Freie Plätze</label><select name="plaetze">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select></div>
            <div class="feld" style="flex-basis:240px"><label>Abfahrt: Uhrzeit und Treffpunkt</label><input type="text" name="treffpunkt" maxlength="120" placeholder="${treffzeit(s) ? `z. B. Abfahrt ${abfahrtVorschlag(s)} Uhr am OTV-Parkplatz` : "z. B. Abfahrt am OTV-Parkplatz"}"></div>
            <div class="feld" style="flex-basis:200px"><label>Hinweis</label><input type="text" name="hinweis" maxlength="160" placeholder="optional, z. B. nur Hinfahrt"></div>
            <button class="knopf">Fahrt anbieten</button>
          </form></details>`;
}
function seiteFahrten() { spieleFilter = "aus"; return seiteSpiele(); }

// ---------- Als App installieren ----------
let installEreignis = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEreignis = e; if (location.hash.replace(/^#\/?/, "") === "") zeigen(); });
window.addEventListener("appinstalled", () => { installEreignis = null; lokal("otv_install_weg", "1"); meldung("App installiert 👍"); });
const istApp = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const istIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const istHandy = () => /iPhone|iPad|iPod|Android/.test(navigator.userAgent);

function installKarte() {
  if (istApp() || !istHandy() || lokal("otv_install_weg")) return "";
  return `<section class="karte install-karte">
    <div><strong>Als App aufs Handy</strong><div class="leise klein">Dann ist die Seite mit OTV-Logo auf dem Startbildschirm, ohne App-Store.</div></div>
    <div class="ausrichten"><button class="knopf klein" data-aktion="app-installieren">So geht’s</button>
      <button class="link-knopf" data-aktion="install-weg">später</button></div>
  </section>`;
}

async function appInstallieren() {
  if (installEreignis) {
    installEreignis.prompt();
    await installEreignis.userChoice.catch(() => null);
    installEreignis = null;
    return;
  }
  const box = document.createElement("div");
  box.className = "lightbox";
  box.innerHTML = `<div class="dialog-box">
    <h2>Als App installieren</h2>
    ${istIOS() ? `<ol class="schritte">
        <li>Diese Seite in <strong>Safari</strong> öffnen (nicht aus WhatsApp heraus).</li>
        <li>Unten auf das <strong>Teilen-Symbol</strong> tippen (Quadrat mit Pfeil nach oben).</li>
        <li>Nach unten scrollen und <strong>„Zum Home-Bildschirm“</strong> wählen.</li>
        <li>Oben rechts auf <strong>„Hinzufügen“</strong> tippen.</li></ol>`
      : `<ol class="schritte">
        <li>Diese Seite in <strong>Chrome</strong> öffnen (nicht aus WhatsApp heraus).</li>
        <li>Oben rechts auf die <strong>drei Punkte ⋮</strong> tippen.</li>
        <li><strong>„App installieren“</strong> oder <strong>„Zum Startbildschirm hinzufügen“</strong> wählen.</li>
        <li>Mit <strong>„Installieren“</strong> bestätigen.</li></ol>`}
    <p class="leise klein">Danach liegt das OTV-Logo auf dem Startbildschirm. Angemeldet bleibt man wie im Browser.</p>
    <button class="knopf gross" data-w="zu">Alles klar</button></div>`;
  box.addEventListener("click", (e) => { if (e.target === box || e.target.dataset.w === "zu") box.remove(); });
  document.body.appendChild(box);
}

// ---------- Willkommen und Name ----------
function installHinweis() {
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return "";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return `<p class="tipp"><strong>Tipp:</strong> Unten in Safari auf <strong>Teilen</strong> tippen und <strong>„Zum Home-Bildschirm“</strong> wählen. Dann ist die Seite wie eine App auf dem Handy.</p>`;
  if (/Android/.test(ua)) return `<p class="tipp"><strong>Tipp:</strong> Oben rechts im Chrome-Menü <strong>⋮</strong> auf <strong>„App installieren“</strong> oder <strong>„Zum Startbildschirm hinzufügen“</strong> tippen.</p>`;
  return "";
}

function willkommen({ nurName = false } = {}) {
  return new Promise((fertig) => {
    const box = document.createElement("div");
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.innerHTML = `<form class="dialog-box">
      ${nurName ? `<h2>Wie heißt du?</h2><p class="leise">Damit die anderen sehen, wer sich eingetragen hat.</p>`
        : `<h2>Willkommen!</h2>
        <p>Hier organisieren wir Eltern alles rund um die Spiele der C-Jugend: Standdienst, Kuchen, Fahrten, Trikots und Kasse.</p>
        <ul class="punkte-liste">
          <li>Eintragen geht mit einem Klick, austragen genauso.</li>
          <li>Was du zugesagt hast, steht auf der Startseite unter <strong>Meine Termine</strong>.</li>
          <li>Absprachen laufen weiter über WhatsApp.</li>
        </ul>`}
      <label for="w-name">Dein Vorname <span class="leise klein">(bitte ohne Nachnamen)</span></label>
      <input id="w-name" type="text" maxlength="40" required value="${esc(meinVorname())}" placeholder="z. B. Peggy" autocomplete="given-name">
      <label for="w-kind" class="abstand" style="margin-top:12px">Dein Sohn in der Mannschaft</label>
      <select id="w-kind"><option value="">${Z.rolle === "trainer" ? "kein Sohn, ich bin Trainer" : "bitte wählen …"}</option>${kader().map((k) => `<option ${k.vorname === meinKind() ? "selected" : ""}>${esc(k.vorname)}</option>`).join("")}</select>
      ${nurName ? "" : installHinweis()}
      <div class="ausrichten abstand" style="margin-top:16px">
        <button class="knopf gross">${nurName ? "Weiter" : "Los geht’s"}</button>
        <button type="button" class="link-knopf" data-w="spaeter">später</button>
      </div></form>`;
    const schliessen = (wert) => { lokal("otv_willkommen", "1"); box.remove(); fertig(wert); };
    box.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const eingabe = box.querySelector("#w-name").value.trim();
      const vorname = eingabe.split(/\s+/)[0];
      if (vorname !== eingabe) meldung(`Gespeichert wird nur der Vorname: ${vorname}`);
      const kind = box.querySelector("#w-kind").value;
      if (!vorname) return;
      lokal("otv_vorname", vorname);
      lokal("otv_kind", kind);
      lokal("otv_name", kind ? `${vorname} (${kind})` : Z.rolle === "trainer" ? `${vorname} (Trainer)` : vorname);
      kopfAktualisieren();
      schliessen(gemerkterName());
    });
    box.querySelector("[data-w=spaeter]").addEventListener("click", () => schliessen(""));
    document.body.appendChild(box);
    setTimeout(() => box.querySelector("#w-name").focus(), 50);
  });
}

async function nameSicherstellen() {
  if (meinName()) return meinName();
  const name = await willkommen({ nurName: true });
  if (!name) throw new Error("Ohne Namen geht das Eintragen leider nicht");
  return name;
}

function kopfAktualisieren() {
  const v = meinVorname();
  $("#hallo").textContent = v ? v : "Name eintragen";
  $("#hallo").title = "Name ändern";
  const galerieSichtbar = Z && (Z.einstellungen.galerieAktiv || istAdmin());
  document.body.classList.toggle("ohne-galerie", !galerieSichtbar);
}

function mehrMenue() {
  const box = document.createElement("div");
  box.className = "lightbox sheet-hinter";
  const links = [
    ["#/trikots", "", "Trikots waschen"], ["#/mannschaft", "", "Mannschaft und Training"],
    ...(Z.einstellungen.galerieAktiv || istAdmin() ? [["#/galerie", "📷", "Galerie"]] : []),
    ...(istAdmin() ? [["#/verwaltung", "⚙️", "Verwaltung"]] : []),
  ];
  box.innerHTML = `<div class="sheet">
    ${links.map(([h, i, t]) => `<a href="${h}">${t}<span class="pfeil">›</span></a>`).join("")}
    <hr>
    <button data-m="name">Name ändern</button>
    ${istApp() ? "" : `<button data-m="app">Als App installieren</button>`}
    <button data-m="hilfe">Hilfe</button>
    <a href="#/datenschutz">Datenschutz</a>
    <button data-m="abmelden">Abmelden</button>
  </div>`;
  box.addEventListener("click", async (e) => {
    const t = e.target.closest("a,button");
    if (e.target === box || t?.tagName === "A") return box.remove();
    if (!t) return;
    box.remove();
    if (t.dataset.m === "name" || t.dataset.m === "hilfe") { await willkommen({ nurName: t.dataset.m === "name" }); zeigen(); }
    if (t.dataset.m === "app") await appInstallieren();
    if (t.dataset.m === "abmelden") { await fetch("/api/logout", { method: "POST" }); location.href = "/login.html"; }
  });
  document.body.appendChild(box);
}

// ---------- Router ----------
function zeigen() {
  const pfad = location.hash.replace(/^#\/?/, "").split("?")[0];
  const seite = SEITEN[pfad] || seiteStart;
  inhalt.innerHTML = seite();
  const nav = { catering: "spiele", fahrten: "spiele", termine: "infos" }[pfad] ?? pfad;
  document.querySelectorAll(".nav a, .unten-nav a").forEach((a) => a.classList.toggle("aktiv", a.getAttribute("href") === "#/" + nav));
  $("#unten-mehr").classList.toggle("aktiv", !["", "spiele", "infos", "kasse"].includes(nav));
  kopfAktualisieren();
  if (pfad === "spiele" && Z.einstellungen.widgetToken) widgetsLaden();
}

let widgetScript = false;
function widgetsLaden() {
  const token = Z.einstellungen.widgetToken;
  if (!widgetScript) {
    // Offizieller Einbettungscode von handball.net
    (function (e, t, n, r, i, s, o) {
      e[i] = e[i] || function () { (e[i].q = e[i].q || []).push(arguments); };
      e[i].l = 1 * new Date(); s = t.createElement(n); o = t.getElementsByTagName(n)[0]; s.async = 1; s.src = r; o.parentNode.insertBefore(s, o);
    })(window, document, "script", "https://www.handball.madebytickaroo.com/widgets/embed/v1.js", "_hb");
    widgetScript = true;
  }
  window._hb({ widget: "spielplan", token, container: "handball-spielplan" });
  window._hb({ widget: "tabelle", token, container: "handball-tabelle" });
}

// ---------- Aktionen ----------
const formWerte = (form) => Object.fromEntries(new FormData(form).entries());
const inCent = (s) => Math.round(Number(String(s).replace(/\./g, "").replace(",", ".")) * 100);
const zeilen = (s) => String(s).split("\n").map((z) => z.trim()).filter(Boolean);

async function neuLaden(text) {
  zuletztGeladen = Date.now();
  await laden();
  zeigen();
  if (text) meldung(text);
}

inhalt.addEventListener("submit", async (ev) => {
  const form = ev.target.closest("form[data-form]");
  if (!form) return;
  ev.preventDefault();
  const art = form.dataset.form;
  const w = formWerte(form);
  const knopf = form.querySelector("button:not([type=button]):not([type=reset])");
  if (knopf) knopf.disabled = true;
  try {
    if (w.name && ["standdienst", "catering", "galerie"].includes(art)) lokal("otv_name", w.name);
    switch (art) {
      case "spiel": {
        const daten = { ...w, heim: w.heim === "true" };
        delete daten.id;
        if (w.id) await api("PUT", "/api/c/spiele/" + w.id, daten);
        else await api("POST", "/api/c/spiele", daten);
        await neuLaden(w.id ? "Spiel geändert, alle Einträge bleiben erhalten" : "Spiel hinzugefügt"); break;
      }
      case "standdienst":
        await api("POST", "/api/c/standdienst", { ...w, spielId: form.dataset.spiel });
        await neuLaden("Danke, du bist eingetragen"); break;
      case "catering": {
        const name = await nameSicherstellen();
        offeneSpiele?.add(form.dataset.spiel);
        await api("POST", "/api/c/catering", { ...w, name, spielId: form.dataset.spiel });
        await neuLaden("Danke für die Zusage"); break;
      }
      case "hinweis":
        await api("POST", "/api/c/hinweise", { text: w.text, bis: w.bis, von: meinVorname() || (Z.rolle === "trainer" ? "Trainerteam" : "") });
        await neuLaden("Info veröffentlicht"); break;
      case "name-zuordnen": {
        const zuordnung = { ...(Z.einstellungen.namenZuordnung || {}), [w.name.trim().toLowerCase()]: w.sohn };
        await api("PUT", "/api/einstellungen", { namenZuordnung: zuordnung });
        await neuLaden(w.sohn === "-" ? `${w.name} wird nicht mitgezählt` : `${w.name} gehört zu ${w.sohn}`); break;
      }
      case "hinweis-edit":
        await api("PUT", "/api/c/hinweise/" + form.dataset.id, { text: w.text, bis: w.bis || "" });
        await neuLaden("Info geändert"); break;
      case "abfrage-edit":
        await api("PUT", "/api/c/abfragen/" + form.dataset.id, { titel: w.titel, text: w.text, optionen: w.optionen, frist: w.frist || "" });
        await neuLaden("Abfrage geändert"); break;
      case "abfrage-neu":
        await api("POST", "/api/c/abfragen", { titel: w.titel, text: w.text, optionen: w.optionen, frist: w.frist, von: meinVorname() });
        await neuLaden("Abfrage gestartet"); break;
      case "abfrage": {
        if (!meinKind()) throw new Error("Bitte zuerst deinen Sohn auswählen");
        const opt = abfrageOptionen(Z.abfragen.find((a) => a.id === form.dataset.id) || {});
        const werte = [...form.querySelectorAll("input[name=o]:checked")].map((x) => x.value);
        if (!opt.length && !werte.length) throw new Error("Bitte Ja oder Nein wählen");
        await api("PUT", `/api/c/abfrageAntworten/${form.dataset.id}-${slug(meinKind())}`, { abfrageId: form.dataset.id, spieler: meinKind(), gewaehlt: opt.length ? (werte.join(",") || "keiner") : werte[0], bemerkung: w.bemerkung || "", von: meinName() });
        await neuLaden("Danke, Antwort gespeichert"); break;
      }
      case "antwort": {
        if (!meinKind()) throw new Error("Bitte zuerst deinen Sohn auswählen");
        const id = `${form.dataset.termin}-${slug(meinKind())}`;
        await api("PUT", "/api/c/antworten/" + id, { terminId: form.dataset.termin, familie: meinKind(), kommt: true, personen: Number(w.personen) || 0, von: meinName() });
        await neuLaden("Danke für deine Rückmeldung"); break;
      }
      case "termin": {
        const kosten = w.kosten.trim() ? inCent(w.kosten) : 0;
        if (!Number.isFinite(kosten) || kosten < 0) throw new Error("Kosten bitte im Format 5,00 eingeben");
        const daten = { titel: w.titel, datum: w.datum, zeit: w.zeit, ort: w.ort, beschreibung: w.beschreibung, frage: w.frage, kostenProPerson: kosten, frist: w.frist || "" };
        if (form.dataset.id) await api("PUT", "/api/c/termine/" + form.dataset.id, daten);
        else await api("POST", "/api/c/termine", daten);
        await neuLaden("Termin gespeichert"); break;
      }
      case "fahrt": {
        const name = await nameSicherstellen();
        offeneSpiele?.add(form.dataset.spiel);
        await api("POST", "/api/c/fahrten", { ...w, fahrer: name, plaetze: Number(w.plaetze), spielId: form.dataset.spiel });
        await neuLaden("Danke, deine Fahrt ist eingetragen"); break;
      }
      case "mitfahrer": {
        let kind = w.name;
        if (kind === "__andere") kind = (prompt("Wer fährt mit? (nur Vorname)") || "").trim();
        if (!kind) throw new Error("Bitte einen Spieler auswählen");
        await api("POST", "/api/c/mitfahrer", { fahrtId: form.dataset.fahrt, name: kind, eingetragenVon: meinName() });
        await neuLaden(`${kind} fährt mit`); break;
      }
      case "abrechnung": {
        const spiel = Z.spiele.find((x) => x.id === w.spielId);
        if (spielBilanz(spiel.id).anzahl && !confirm("Für dieses Spiel gibt es schon Buchungen. Trotzdem zusätzlich buchen?")) break;
        const zweck = `Heimspiel-Catering gegen ${spiel.gegner}`;
        const buchungen = [];
        for (const k of Z.einstellungen.kassenKanaele) {
          const c = inCent(w["ein:" + k] || "");
          if (c > 0) buchungen.push({ art: "einnahme", betrag: c, zweck, kategorie: "Heimspiel-Catering", kanal: k });
        }
        const getr = inCent(w.getraenke || "");
        if (getr > 0) buchungen.push({ art: "ausgabe", betrag: getr, zweck: `Getränke OTV, Heimspiel gegen ${spiel.gegner}`, kategorie: "Getränke OTV", kanal: w.getraenkeKanal });
        const eink = inCent(w.einkauf || "");
        if (eink > 0) buchungen.push({ art: "ausgabe", betrag: eink, zweck: `Einkauf Catering, Heimspiel gegen ${spiel.gegner}`, kategorie: "Einkauf Catering", kanal: w.einkaufKanal });
        if ([...Object.entries(w)].some(([k, v]) => /^(ein:|getraenke$|einkauf$)/.test(k) && v.trim() && !(inCent(v) > 0))) throw new Error("Bitte Beträge im Format 12,50 eingeben");
        if (!buchungen.length) throw new Error("Bitte mindestens einen Betrag eintragen");
        for (const b of buchungen) await api("POST", "/api/c/kasse", { ...b, datum: spiel.datum, spielId: spiel.id, beleg: w.beleg || "" });
        await neuLaden(`${buchungen.length} Buchung${buchungen.length === 1 ? "" : "en"} gespeichert`);
        teilen(abrechnungsText(spiel.id));
        break;
      }
      case "kader":
        await api("POST", "/api/c/kader", w);
        await neuLaden("Spieler hinzugefügt"); break;
      case "trainer":
        await api("PUT", "/api/c/trainer/" + form.dataset.id, w);
        await neuLaden("Gespeichert"); break;
      case "trainer-neu":
        await api("POST", "/api/c/trainer", { ...w, reihenfolge: Z.trainer.length + 1 });
        await neuLaden("Trainer hinzugefügt"); break;
      case "kasse": {
        const betrag = inCent(w.betrag);
        if (!(betrag > 0)) throw new Error("Bitte einen gültigen Betrag eingeben, z. B. 12,50");
        const daten = { ...w, betrag };
        delete daten.id;
        if (w.id) await api("PUT", "/api/c/kasse/" + w.id, daten);
        else await api("POST", "/api/c/kasse", daten);
        await neuLaden(w.id ? "Buchung geändert" : "Buchung gespeichert"); break;
      }
      case "einstellungen": {
        const daten = {
          anfangsbestand: inCent(w.anfangsbestand),
          anfangsdatum: w.anfangsdatum,
          standdienstPlaetze: w.standdienstPlaetze,
          reservePlaetze: w.reservePlaetze,
          galerieAktiv: w.galerieAktiv === "on",
          vorratArtikel: zeilen(w.vorratArtikel).map((z) => { const [name, hinweis] = z.split("|").map((x) => (x || "").trim()); return { name, hinweis: hinweis || "" }; }),
          waescheArtikel: zeilen(w.waescheArtikel),
          zeitnehmerBei: w.zeitnehmerBei,
          zeitnehmerPlaetze: w.zeitnehmerPlaetze,
          standdienstVorlauf: w.standdienstVorlauf,
          standdienstInfo: w.standdienstInfo,
          liga: w.liga,
          teamText: w.teamText,
          hallen: zeilen(w.hallen).map((z) => { const [name, ...rest] = z.split("|").map((x) => (x || "").trim()); return { name, adresse: rest.join(", ") }; }).filter((h) => h.name),
          trainingszeiten: zeilen(w.trainingszeiten).map((z) => { const [tag, zeit, halle] = z.split("|").map((x) => (x || "").trim()); return { tag, zeit, halle }; }),
          cateringArtikel: zeilen(w.cateringArtikel).map((z) => { const [name, bedarf, hinweis, modus] = z.split("|").map((x) => (x || "").trim()); return { name, bedarf: Math.max(1, parseInt(bedarf, 10) || 1), hinweis: hinweis || "", immer: !/bedarf/i.test(modus || "") }; }),
          kassenKategorien: zeilen(w.kassenKategorien),
          kassenKanaele: zeilen(w.kassenKanaele),
          widgetToken: w.widgetToken.trim(),
          handballNetUrl: w.handballNetUrl.trim(),
        };
        if (!Number.isFinite(daten.anfangsbestand)) throw new Error("Anfangsbestand ungültig");
        await api("PUT", "/api/einstellungen", daten);
        await neuLaden("Einstellungen gespeichert"); break;
      }
      case "galerie":
        await fotosHochladen(form, w); break;
    }
  } catch (e) {
    meldung(e.message, true);
  } finally {
    if (knopf) knopf.disabled = false;
  }
});

inhalt.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-aktion]");
  if (!el || el.tagName === "SELECT" || el.type === "checkbox") return;
  const a = el.dataset.aktion;
  try {
    if (a === "loeschen") {
      if (el.dataset.frage && !confirm(el.dataset.frage)) return;
      const r = await api("DELETE", `/api/c/${el.dataset.col}/${el.dataset.id}`);
      await neuLaden(r && r.nachgerueckt ? `Ausgetragen. ${anzeigeName(r.nachgerueckt)} rückt von der Reserve nach.` : "Entfernt");
    } else if (a === "standdienst-ich") {
      const name = await nameSicherstellen();
      offeneSpiele?.add(el.dataset.spiel);
      el.disabled = true;
      await api("POST", "/api/c/standdienst", { spielId: el.dataset.spiel, name, reserve: el.dataset.reserve === "1" });
      await neuLaden(el.dataset.reserve ? "Danke, du bist als Reserve eingetragen" : "Danke, du bist eingetragen");
    } else if (a === "springen-catering") {
      ev.preventDefault();
      if (offeneSpiele === null) offeneSpiele = new Set();
      offeneSpiele.add(el.dataset.id);
      location.hash = "#/catering";
      setTimeout(() => document.getElementById("spiel-" + el.dataset.id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    } else if (a === "menge-aendern") {
      const sp = Z.spiele.find((x) => x.id === el.dataset.spiel);
      const art = Z.einstellungen.cateringArtikel.find((x) => x.name === el.dataset.artikel);
      const m = mengenAnders(sp);
      const neu = Math.max(1, mengeFuer(sp, art) + Number(el.dataset.delta));
      if (neu === art.bedarf) delete m[art.name]; else m[art.name] = neu;
      offeneSpiele?.add(sp.id);
      await api("PUT", "/api/c/spiele/" + sp.id, { mengen: Object.entries(m).map(([k, v]) => `${k}=${v}`).join(",") });
      await neuLaden(`${art.name}: diesmal ${neu}×`);
    } else if (a === "artikel-umschalten") {
      const sp = Z.spiele.find((x) => x.id === el.dataset.spiel);
      const liste = anders(sp);
      const neu = liste.includes(el.dataset.artikel) ? liste.filter((x) => x !== el.dataset.artikel) : [...liste, el.dataset.artikel];
      offeneSpiele?.add(sp.id);
      await api("PUT", "/api/c/spiele/" + sp.id, { artikelAnders: neu.join(",") });
      await neuLaden(`${el.dataset.artikel}: ${gebraucht({ artikelAnders: neu.join(",") }, Z.einstellungen.cateringArtikel.find((x) => x.name === el.dataset.artikel)) ? "wird diesmal gebraucht" : "diesmal nicht nötig"}`);
    } else if (a === "spiel-bearbeiten") {
      const sp = Z.spiele.find((x) => x.id === el.dataset.id);
      const f = inhalt.querySelector('form[data-form="spiel"]');
      for (const k of ["id", "datum", "zeit", "gegner", "halle", "hinweis"]) f.elements[k].value = sp[k] || "";
      f.elements.heim.value = sp.heim ? "true" : "false";
      $("#spiel-titel").textContent = `Spiel ändern: ${sp.gegner}`;
      $("#spiel-formular").open = true;
      f.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (a === "spiel-abbrechen") {
      setTimeout(() => { $("#spiel-titel").textContent = "Spiel hinzufügen"; inhalt.querySelector('form[data-form="spiel"]').elements.id.value = ""; });
    } else if (a === "zeitnehmer-ich") {
      const name = await nameSicherstellen();
      el.disabled = true;
      await api("POST", "/api/c/zeitnehmer", { spielId: el.dataset.spiel, name });
      await neuLaden("Danke, du bist Zeitnehmer");
    } else if (a === "whatsapp-zeitnehmer") {
      const fehlend = kommende(spieleSortiert()).filter(zeitnehmerFehlt);
      teilen(["⏱ Zeitnehmer gesucht!", Z.einstellungen.zeitnehmerHinweis || "", "",
        ...fehlend.map((s) => `• ${wtDatum(s)}${s.zeit ? " " + s.zeit + " Uhr" : ""} ${s.heim ? "gegen" : "bei"} ${s.gegner}`),
        "", `Eintragen: ${location.origin}/#/spiele`].filter((x, i, arr) => !(x === "" && arr[i - 1] === "")).join("\n"));
    } else if (a === "vorrat-setzen") {
      const name = await nameSicherstellen();
      await api("PUT", "/api/c/vorrat/" + slug(el.dataset.artikel), { artikel: el.dataset.artikel, status: el.dataset.status, von: name, datum: heute() });
      await neuLaden(el.dataset.status === "ok" ? `${el.dataset.artikel}: reicht` : `${el.dataset.artikel} kommt auf die Mitbringliste`);
    } else if (a === "waesche-ich") {
      const name = await nameSicherstellen();
      el.disabled = true;
      offeneSpiele?.add(el.dataset.spiel);
      await api("POST", "/api/c/waschdienst", { spielId: el.dataset.spiel, name });
      await neuLaden("Danke fürs Waschen");
    } else if (a === "antwort-absage") {
      if (!meinKind()) throw new Error("Bitte zuerst deinen Sohn auswählen");
      await api("PUT", `/api/c/antworten/${el.dataset.termin}-${slug(meinKind())}`, { terminId: el.dataset.termin, familie: meinKind(), kommt: false, personen: 0, von: meinName() });
      await neuLaden("Schade, Absage ist eingetragen");
    } else if (a === "antwort-buchen" || a === "antwort-bezahlt") {
      const tm = Z.termine.find((x) => x.id === el.dataset.termin);
      const id = `${tm.id}-${slug(el.dataset.familie)}`;
      const ant = Z.antworten.find((x) => x.id === id);
      if (a === "antwort-buchen") {
        const betrag = (ant.personen || 0) * (tm.kostenProPerson || 0);
        await api("POST", "/api/c/kasse", { datum: heute(), art: "einnahme", betrag, zweck: `${tm.titel}: Familie von ${el.dataset.familie}`, kategorie: "Mannschaftsfeier", kanal: "Bar", beleg: "" });
        await api("PUT", "/api/c/antworten/" + id, { bezahlt: true });
        await neuLaden(`${euro(betrag)} gebucht`);
      } else {
        await api("PUT", "/api/c/antworten/" + id, { bezahlt: false });
        await neuLaden("Als unbezahlt markiert. Die Buchung bitte in der Kasse löschen, falls nötig.");
      }
    } else if (a === "abfrage-zelle") {
      const ab = Z.abfragen.find((x) => x.id === el.dataset.id);
      const alt = abfrageAntwort(ab, el.dataset.spieler);
      let gewaehlt;
      if (el.dataset.index === "ja") gewaehlt = alt?.gewaehlt === "ja" ? "nein" : "ja";
      else {
        const menge = new Set((alt?.gewaehlt || "").split(",").filter((x) => x !== "" && x !== "keiner"));
        if (menge.has(el.dataset.index)) menge.delete(el.dataset.index); else menge.add(el.dataset.index);
        gewaehlt = [...menge].sort((x, y) => x - y).join(",") || "keiner";
      }
      await api("PUT", `/api/c/abfrageAntworten/${ab.id}-${slug(el.dataset.spieler)}`, { abfrageId: ab.id, spieler: el.dataset.spieler, gewaehlt, von: alt?.von || `${meinVorname() || "Trainer"} (eingetragen)` });
      await neuLaden("Gespeichert");
    } else if (a === "abfrage-schliessen") {
      await api("PUT", "/api/c/abfragen/" + el.dataset.id, { geschlossen: el.dataset.wert === "ja" });
      await neuLaden(el.dataset.wert === "ja" ? "Abfrage beendet" : "Abfrage wieder offen");
    } else if (a === "name-zuordnung-loesen") {
      const zuordnung = { ...(Z.einstellungen.namenZuordnung || {}) };
      delete zuordnung[el.dataset.name];
      await api("PUT", "/api/einstellungen", { namenZuordnung: zuordnung });
      await neuLaden("Zuordnung gelöst");
    } else if (a === "name-aendern") {
      await willkommen({ nurName: true }); zeigen();
    } else if (a === "mitfahren-schnell") {
      el.disabled = true;
      await api("POST", "/api/c/mitfahrer", { fahrtId: el.dataset.fahrt, name: meinKind(), eingetragenVon: meinName() });
      await neuLaden(`${meinKind()} fährt mit`);
    } else if (a === "fahrt-anbieten") {
      ev.preventDefault();
      if (offeneSpiele === null) offeneSpiele = new Set();
      offeneSpiele.add(el.dataset.id);
      for (const id of ["spiel-", "mehr-", "anbieten-"]) { const d = document.getElementById(id + el.dataset.id); if (d) d.open = true; }
      document.getElementById("anbieten-" + el.dataset.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (a === "spiele-filter") {
      spieleFilter = el.dataset.wert;
      if (location.hash !== "#/spiele") location.hash = "#/spiele"; else zeigen();
    } else if (a === "app-installieren") {
      await appInstallieren();
    } else if (a === "install-weg") {
      lokal("otv_install_weg", "1"); zeigen();
    } else if (a === "mitbringen-liste") {
      const box = document.getElementById(el.dataset.ziel || "mitbringen-auswahl");
      box.hidden = !box.hidden;
      el.setAttribute("aria-expanded", String(!box.hidden));
      if (!box.hidden) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else if (a === "bringe-schnell") {
      const name = await nameSicherstellen();
      el.disabled = true;
      await api("POST", "/api/c/catering", { spielId: el.dataset.spiel, artikel: el.dataset.artikel, name, menge: "" });
      await neuLaden(`Danke, du bringst ${el.dataset.artikel} mit`);
    } else if (a === "kalender-link-kopieren") {
      try { await navigator.clipboard.writeText(el.dataset.link); meldung("Link kopiert"); }
      catch { window.prompt("Link zum Kopieren:", el.dataset.link); }
    } else if (a === "kalender-link-neu") {
      if (!confirm("Neuen Kalender-Link erzeugen? Der alte funktioniert dann nicht mehr, alle Eltern müssen neu abonnieren.")) return;
      const r = await api("POST", "/api/kalender-link/neu");
      kalenderPfad = r.pfad;
      await neuLaden("Neuer Kalender-Link erzeugt");
    } else if (a === "kalender-spiele") {
      kalenderLaden(kommende(spieleSortiert()).map((sp) => ({
        key: "spiel-" + sp.id, spiel: sp, link: "#/spiele",
        titel: `Handball C-Jugend: ${sp.heim ? "OTV gegen " + sp.gegner : sp.gegner + " gegen OTV"}`,
        text: `${sp.heim ? "Heimspiel" : "Auswärtsspiel"}${treffzeit(sp) ? `, Jungs um ${treffzeit(sp)} Uhr in der Halle` : ""}`,
      })));
    } else if (a === "kalender") {
      kalenderLaden(el.dataset.alle ? meineTermine() : meineTermine().filter((t) => t.key === el.dataset.key));
    } else if (a === "kassen-details") {
      kassenDetails = !kassenDetails; zeigen();
    } else if (a === "mitbringen-oeffnen") {
      const f = inhalt.querySelector(`form[data-key="${el.dataset.key}"]`);
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector("input[name=menge]").focus();
    } else if (a === "whatsapp-spiel") {
      const sp = Z.spiele.find((x) => x.id === el.dataset.spiel);
      teilen(spielNachricht(sp));
    } else if (a === "whatsapp-catering") {
      teilen(cateringText(Z.spiele.find((x) => x.id === el.dataset.spiel)));
    } else if (a === "whatsapp-fahrten") {
      teilen(fahrtenText(Z.spiele.find((x) => x.id === el.dataset.spiel)));
    } else if (a === "whatsapp-abrechnung") {
      teilen(abrechnungsText(el.dataset.spiel));
    } else if (a === "springen") {
      const d = document.getElementById("spiel-" + el.dataset.id);
      d.open = true;
      d.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (a === "kassenfilter") {
      kassenFilter = el.dataset.wert; zeigen();
    } else if (a === "album") {
      albumFilter = el.dataset.wert; zeigen();
    } else if (a === "csv") {
      csvExport();
    } else if (a === "buchung-bearbeiten") {
      const b = Z.kasse.find((x) => x.id === el.dataset.id);
      const f = inhalt.querySelector('form[data-form="kasse"]');
      for (const [k, v] of Object.entries(b)) if (f.elements[k]) f.elements[k].value = k === "betrag" ? (v / 100).toFixed(2).replace(".", ",") : v;
      $("#buchung-titel").textContent = "Buchung ändern";
      $("#buchung-klappe").open = true;
      f.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (a === "buchung-abbrechen") {
      setTimeout(() => { $("#buchung-titel").textContent = "Einzelne Buchung erfassen"; inhalt.querySelector('form[data-form="kasse"]').elements.id.value = ""; });
    } else if (a === "foto") {
      lightbox(Number(el.dataset.index));
    }
  } catch (e) {
    meldung(e.message, true);
  }
});

inhalt.addEventListener("toggle", (ev) => {
  const d = ev.target;
  if (!d.classList?.contains("spiel-karte")) return;
  const menge = offeneSpiele;
  if (!menge) return;
  if (d.open) menge.add(d.dataset.spiel); else menge.delete(d.dataset.spiel);
}, true);

inhalt.addEventListener("change", async (ev) => {
  const el = ev.target;
  try {
    if (el.dataset.aktion === "antwort-admin") {
      const id = `${el.dataset.termin}-${slug(el.dataset.familie)}`;
      const alt = Z.antworten.find((x) => x.id === id);
      if (el.dataset.feld === "kommt") {
        if (el.value === "") { if (alt) await api("DELETE", "/api/c/antworten/" + id); }
        else await api("PUT", "/api/c/antworten/" + id, { terminId: el.dataset.termin, familie: el.dataset.familie, kommt: el.value === "ja", personen: el.value === "ja" ? (alt?.personen || 0) : 0, von: "Kasse" });
      } else {
        await api("PUT", "/api/c/antworten/" + id, { terminId: el.dataset.termin, familie: el.dataset.familie, kommt: true, personen: Number(el.value) || 0 });
      }
      await neuLaden("Gespeichert");
      return;
    }
    if (el.dataset.aktion === "name-zuordnen") {
      if (!el.value) return;
      if (el.value === "__loesen") {
        const z = { ...(Z.einstellungen.namenZuordnung || {}) };
        delete z[el.dataset.name.trim().toLowerCase()];
        await api("PUT", "/api/einstellungen", { namenZuordnung: z });
        await neuLaden("Zuordnung gelöst");
        return;
      }
      const zuordnung = { ...(Z.einstellungen.namenZuordnung || {}), [el.dataset.name.trim().toLowerCase()]: el.value };
      await api("PUT", "/api/einstellungen", { namenZuordnung: zuordnung });
      await neuLaden(el.value === "-" ? `${el.dataset.name} wird nicht mitgezählt` : `${el.dataset.name} gehört zu ${el.value}`);
      return;
    }
    if (el.dataset.aktion === "trikot-erledigt") {
      await api("PUT", "/api/c/trikots/" + el.dataset.id, { erledigt: el.checked });
      await neuLaden(el.checked ? "Als gewaschen markiert" : "Markierung entfernt");
    } else if (el.dataset.aktion === "trikot-tausch") {
      await api("PUT", "/api/c/trikots/" + el.dataset.id, { familie: el.value });
      await neuLaden("Trikotplan aktualisiert");
    }
  } catch (e) {
    meldung(e.message, true);
  }
});

function csvExport() {
  const e = Z.einstellungen;
  let lauf = e.anfangsbestand;
  const zeilenCsv = [["Datum", "Art", "Betrag", "Zweck", "Kategorie", "Bezahlt per", "Spiel", "Beleg", "Kassenstand"]];
  zeilenCsv.push([e.anfangsdatum, "Anfangsbestand", "", "", "", "", "", "", (lauf / 100).toFixed(2).replace(".", ",")]);
  for (const b of kassenBuchungen()) {
    lauf += b.art === "einnahme" ? b.betrag : -b.betrag;
    zeilenCsv.push([b.datum, b.art === "einnahme" ? "Einnahme" : "Ausgabe", ((b.art === "einnahme" ? 1 : -1) * b.betrag / 100).toFixed(2).replace(".", ","),
      b.zweck, b.kategorie, b.kanal, spielName(b.spielId), b.beleg, (lauf / 100).toFixed(2).replace(".", ",")]);
  }
  const csv = "﻿" + zeilenCsv.map((z) => z.map((f) => `"${String(f ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `Kassenbericht_C-Jugend_${heute()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------- Galerie: verkleinern, hochladen, ansehen ----------
async function verkleinern(datei, maxKante, qualitaet) {
  let bild;
  try {
    bild = await createImageBitmap(datei, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`„${datei.name}“ kann nicht gelesen werden. Bitte als JPEG oder PNG hochladen.`);
  }
  const faktor = Math.min(1, maxKante / Math.max(bild.width, bild.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bild.width * faktor);
  canvas.height = Math.round(bild.height * faktor);
  canvas.getContext("2d").drawImage(bild, 0, 0, canvas.width, canvas.height);
  bild.close?.();
  // Neu kodiert: EXIF-Daten inklusive GPS-Standort gehen dabei verloren
  return new Promise((ok) => canvas.toBlob(ok, "image/jpeg", qualitaet));
}

async function fotosHochladen(form, w) {
  const dateien = [...form.elements.dateien.files];
  if (!dateien.length) throw new Error("Bitte Fotos auswählen");
  if (dateien.length > 30) throw new Error("Bitte höchstens 30 Fotos auf einmal");
  const status = $("#upload-status");
  let fertig = 0;
  for (const datei of dateien) {
    status.innerHTML = `<div class="leise">Lade ${fertig + 1} von ${dateien.length} hoch …</div><div class="fortschritt"><div style="width:${(fertig / dateien.length) * 100}%"></div></div>`;
    const gross = await verkleinern(datei, 1800, 0.82);
    const klein = await verkleinern(datei, 480, 0.75);
    const fd = new FormData();
    fd.append("gross", gross, "gross.jpg");
    fd.append("klein", klein, "klein.jpg");
    fd.append("album", w.album);
    fd.append("name", w.name || "");
    await api("POST", "/api/galerie", fd);
    fertig++;
  }
  galerie = await api("GET", "/api/galerie");
  albumFilter = w.album.trim() || "Alle";
  zeigen();
  meldung(`${fertig} Foto${fertig === 1 ? "" : "s"} hochgeladen`);
}

function lightbox(start) {
  const liste = galerie.filter((f) => albumFilter === "Alle" || f.album === albumFilter);
  let i = start;
  const box = document.createElement("div");
  box.className = "lightbox";
  box.setAttribute("role", "dialog");
  const zeichnen = () => {
    const f = liste[i];
    box.innerHTML = `<button class="lb-zu" aria-label="Schließen">×</button>
      ${liste.length > 1 ? `<button class="lb-nav links" aria-label="Vorheriges">‹</button><button class="lb-nav rechts" aria-label="Nächstes">›</button>` : ""}
      <img src="/api/foto/${f.id}/gross" alt="${esc(f.titel || f.album)}">
      <div class="lightbox-leiste"><span>${esc(f.album)}${f.name ? " · von " + esc(f.name) : ""} · ${i + 1}/${liste.length}</span>
        <a class="knopf zweit klein" href="/api/foto/${f.id}/gross" download="OTV-C-Jugend-${f.id}.jpg">Speichern</a>
        ${f.gemeldet && istAdmin() ? `<span style="color:#ffb3ab">Gemeldet: ${esc(f.meldegrund || "ohne Grund")}</span><button class="knopf zweit klein" data-lb="freigeben">Freigeben</button>`
          : `<button class="knopf zweit klein" data-lb="melden">Melden</button>`}
        ${darfLoeschen(f) ? `<button class="knopf zweit klein" data-lb="loeschen">Löschen</button>` : ""}
      </div>`;
  };
  const schliessen = () => { box.remove(); document.removeEventListener("keydown", tasten); };
  const tasten = (e) => {
    if (e.key === "Escape") schliessen();
    if (e.key === "ArrowLeft") { i = (i - 1 + liste.length) % liste.length; zeichnen(); }
    if (e.key === "ArrowRight") { i = (i + 1) % liste.length; zeichnen(); }
  };
  box.addEventListener("click", async (e) => {
    const t = e.target;
    if (t === box || t.classList.contains("lb-zu")) return schliessen();
    if (t.classList.contains("links")) { i = (i - 1 + liste.length) % liste.length; return zeichnen(); }
    if (t.classList.contains("rechts")) { i = (i + 1) % liste.length; return zeichnen(); }
    const f = liste[i];
    try {
      if (t.dataset.lb === "melden") {
        const grund = prompt("Warum soll das Foto entfernt werden? Es wird sofort ausgeblendet und von der Kassenführung geprüft.");
        if (grund === null) return;
        await api("POST", `/api/galerie/${f.id}/melden`, { grund });
        meldung("Danke, das Foto wurde ausgeblendet");
      } else if (t.dataset.lb === "freigeben") {
        await api("POST", `/api/galerie/${f.id}/freigeben`);
        meldung("Foto freigegeben");
      } else if (t.dataset.lb === "loeschen") {
        if (!confirm("Foto endgültig löschen?")) return;
        await api("DELETE", `/api/galerie/${f.id}`);
        meldung("Foto gelöscht");
      } else return;
      galerie = await api("GET", "/api/galerie");
      schliessen();
      zeigen();
    } catch (err) {
      meldung(err.message, true);
    }
  });
  document.addEventListener("keydown", tasten);
  zeichnen();
  document.body.appendChild(box);
}

// ---------- Start ----------
$("#unten-mehr").addEventListener("click", mehrMenue);
$("#hallo").addEventListener("click", async () => { await willkommen({ nurName: true }); zeigen(); });
$("#abmelden").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login.html";
});
let letzterPfad = "";
window.addEventListener("hashchange", () => {
  const pfad = location.hash.replace(/^#\/?/, "").split("?")[0];
  if (pfad === "spiele" && !["spiele", "catering", "fahrten"].includes(letzterPfad)) spieleFilter = "alle";
  letzterPfad = pfad;
  zeigen(); window.scrollTo(0, 0);
});

// Aktuelle Daten holen, wenn die Seite wieder in den Vordergrund kommt (z. B. App vom Startbildschirm)
let zuletztGeladen = Date.now();
async function stillAktualisieren() {
  if (document.hidden || Date.now() - zuletztGeladen < 60_000) return;
  // Nicht stören, wenn gerade ein Fenster offen ist oder jemand tippt
  if (document.querySelector(".lightbox") || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  try {
    await laden();
    zuletztGeladen = Date.now();
    const y = window.scrollY;
    zeigen();
    window.scrollTo(0, y);
  } catch { /* offline: alten Stand behalten */ }
}
document.addEventListener("visibilitychange", stillAktualisieren);
window.addEventListener("focus", stillAktualisieren);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

// Früher eingegebene Nachnamen auf dem Gerät entfernen, damit neue Einträge nur den Vornamen tragen
(() => {
  const v = (lokal("otv_vorname") || "").trim();
  if (v && /\s/.test(v)) {
    const nur = v.split(/\s+/)[0];
    lokal("otv_vorname", nur);
    const k = lokal("otv_kind");
    lokal("otv_name", k ? `${nur} (${k})` : (lokal("otv_name") || "").includes("(Trainer)") ? `${nur} (Trainer)` : nur);
  }
})();

laden().then(() => {
  zeigen();
  const alteRolle = lokal("otv_rolle");
  lokal("otv_rolle", Z.rolle);
  if (!lokal("otv_willkommen") && !meinName()) willkommen().then(() => zeigen());
  else if (alteRolle && alteRolle !== Z.rolle) willkommen({ nurName: true }).then(() => zeigen());
  else if (meinKind() && !Z.kader.some((k) => k.vorname === meinKind())) {
    // Kader wurde geändert (z. B. "Levi" heißt jetzt "Levi H."): Sohn einmal neu auswählen lassen
    lokal("otv_kind", "");
    willkommen({ nurName: true }).then(() => zeigen());
  }
}).catch((e) => {
  inhalt.innerHTML = `<div class="hinweis">Die Seite konnte nicht geladen werden: ${esc(e.message)}</div>`;
});
