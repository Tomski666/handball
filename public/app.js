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
    <div class="leise">${s.zeit ? esc(s.zeit) + " Uhr · " : ""}${esc(s.halle || "Halle offen")}
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
const AUSTRAGEN_HINWEIS = "Austragen geht nur auf dem Handy, mit dem du dich eingetragen hast. Sonst kurz in die WhatsApp-Gruppe schreiben.";
const kopfzeile = (unter, titel) => `<p class="unterzeile">${unter}</p><h1>${titel}</h1>`;

// ---------- Seiten ----------
const SEITEN = {
  "": seiteStart,
  mannschaft: seiteMannschaft,
  spiele: seiteSpiele,
  catering: seiteCatering,
  fahrten: seiteFahrten,
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
    if (kommt(sp)) t.push({ key: "s" + d.id, spiel: sp, text: d.reserve ? "Du bist Reserve beim Standdienst" : `Du hast Standdienst${treffzeit(sp) ? ` (spätestens ${treffzeit(sp)} Uhr da sein)` : ""}`, standdienst: true, link: "#/catering" });
  }
  for (const c of Z.catering.filter((x) => x.eigen)) {
    const sp = spiel(c.spielId);
    if (kommt(sp)) t.push({ key: "c" + c.id, spiel: sp, text: `Du bringst ${c.artikel} mit${c.menge ? ` (${c.menge})` : ""}`, link: "#/catering" });
  }
  for (const f of Z.fahrten.filter((x) => x.eigen)) {
    const sp = spiel(f.spielId);
    const mit = Z.mitfahrer.filter((m) => m.fahrtId === f.id).map((m) => m.name);
    if (kommt(sp)) t.push({ key: "f" + f.id, spiel: sp, text: `Du fährst${mit.length ? ": " + mit.join(", ") : ""}${f.treffpunkt ? " · " + f.treffpunkt : ""}`, link: "#/fahrten" });
  }
  for (const m of Z.mitfahrer.filter((x) => x.eigen)) {
    const f = Z.fahrten.find((x) => x.id === m.fahrtId);
    const sp = f && spiel(f.spielId);
    if (kommt(sp)) t.push({ key: "m" + m.id, spiel: sp, text: `${m.name} fährt mit bei ${f.fahrer.split(" (")[0]}${f.treffpunkt ? " · " + f.treffpunkt : ""}`, link: "#/fahrten" });
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
    const titel = `${t.text.split(" · ")[0]}: ${s.heim ? "OTV gegen " + s.gegner : s.gegner + " gegen OTV"}`;
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
    if (s.halle) z.push(`LOCATION:${s.halle.replace(/[,;]/g, "\\$&")}`);
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

function seiteStart() {
  const e = Z.einstellungen;
  const heim = kommende(heimspiele())[0];

  let hero = `<section class="karte hero"><p class="leer">Gerade steht kein Heimspiel an.</p></section>`;
  if (heim) {
    const st = cateringStatus(heim);
    const ichDienst = Z.standdienst.some((x) => x.spielId === heim.id && x.eigen);
    const frei = st.plaetze - st.dienst;
    const knoepfe = [];
    if (frei > 0 && !ichDienst) knoepfe.push(`<button class="knopf gross" data-aktion="standdienst-ich" data-spiel="${heim.id}">🙋 Ich übernehme Standdienst</button>`);
    if (st.offen.length) knoepfe.push(`<button class="knopf zweit gross" data-aktion="mitbringen-liste" aria-expanded="false">🍰 Ich bringe etwas mit</button>`);
    const artikelKnoepfe = st.offen.map((a) => `<button class="knopf zweit gross" data-aktion="bringe-schnell" data-spiel="${heim.id}" data-artikel="${esc(a.name)}">${esc(a.name)}${a.hinweis ? `<small>${esc(a.hinweis)}</small>` : ""}</button>`).join("");
    hero = `<section class="karte hero">
      <div class="kachel-label">Nächstes Heimspiel</div>
      ${spielZeile(heim)}
      <div class="hero-status">
        ${st.komplett ? `<p class="gut">✓ Alles besetzt, danke!</p>` : `<p><strong>Es fehlen noch:</strong> ${[frei > 0 ? `${frei}× Standdienst` : "", ...st.offen.map((a) => `${a.bedarf - a.zugesagt}× ${a.name}`)].filter(Boolean).map(esc).join(", ")}</p>`}
        ${ichDienst ? `<p class="gut">✓ Du hast hier Standdienst${treffzeit(heim) ? `, bitte spätestens um ${treffzeit(heim)} Uhr da sein` : ""}.</p>` : ""}
      </div>
      ${knoepfe.length ? `<div class="hero-aktionen">${knoepfe.join("")}</div>` : ""}
      ${st.offen.length ? `<div class="mitbringen-auswahl" id="mitbringen-auswahl" hidden>
        <p class="leise klein" style="margin:12px 0 6px">Was bringst du mit? Einmal antippen genügt.</p>
        <div class="hero-knoepfe">${artikelKnoepfe}</div></div>` : ""}
      <p class="abstand" style="margin-bottom:0"><a href="#/catering">Alle Heimspiele ansehen</a></p>
    </section>`;
  }

  const termine = meineTermine();
  const meine = `<section class="karte">
    <div class="karte-kopf" style="margin-bottom:4px"><h2 style="margin:0">Meine Termine</h2>
      ${termine.length > 1 ? `<button class="link-knopf" data-aktion="kalender" data-alle="1">📅 Alle in den Kalender</button>` : ""}</div>
    ${termine.length ? `<ul class="liste">${termine.map((t) => `<li>
        <a class="termin" href="${t.link}">${datumBlock(t.spiel.datum)}<span><strong>${esc(t.text)}</strong>
          <span class="leise klein">${t.spiel.zeit ? esc(t.spiel.zeit) + " Uhr · " : ""}${t.spiel.heim ? "gegen " : "bei "}${esc(t.spiel.gegner)}</span></span></a>
        <button class="knopf zweit klein" data-aktion="kalender" data-key="${t.key}" aria-label="In den Kalender">📅 In Kalender</button></li>`).join("")}</ul>`
      : `<p class="leer">Du hast dich noch nirgends eingetragen. Oben geht es mit einem Klick.</p>`}
  </section>`;

  // Auswärtsfahrt nur zeigen, wenn sie in den nächsten 10 Tagen ansteht
  const fahrt = kommende(auswaertsspiele())[0];
  const bald = fahrt && (datum(fahrt.datum) - datum(heute())) / 864e5 <= 10;

  return `<p class="unterzeile">${meinVorname() ? "Hallo " + esc(meinVorname()) : "Willkommen"}</p><h1>Was steht an?</h1>
  ${hero}
  <div class="abstand">${meine}</div>
  ${bald ? `<div class="abstand">${fahrtKachel()}</div>` : ""}`;
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
      <ul class="liste">${e.trainingszeiten.map((t) => `<li><div><strong>${esc(t.tag)}</strong><div class="leise">${esc(t.zeit)}</div></div><span>${esc(t.halle)}</span></li>`).join("")}</ul>
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

function seiteSpiele() {
  const e = Z.einstellungen;
  const liste = spieleSortiert();
  const k = kommende(liste), v = vergangene(liste);
  const zeile = (s) => `<li>${spielZeile(s)}${istAdmin() ? `<button class="knopf klein gefahr" data-aktion="loeschen" data-col="spiele" data-id="${s.id}" data-frage="Spiel löschen? Standdienst-, Catering- und Trikot-Einträge zu diesem Spiel bleiben erhalten, werden aber nicht mehr angezeigt.">Löschen</button>` : ""}</li>`;
  return `${kopfzeile("Was passiert wann und wo?", "Spiele")}
  <div class="raster-2">
    <section class="karte">
      <h2>Spielplan und Tabelle</h2>
      ${e.widgetToken
        ? `<div id="handball-spielplan"></div><div id="handball-tabelle" class="abstand"></div>`
        : `<p>Spielplan, Ergebnisse und Tabelle kommen direkt von handball.net.</p>`}
      <a class="knopf zweit" href="${esc(e.handballNetUrl)}" target="_blank" rel="noopener">Auf handball.net öffnen</a>
    </section>
    <section class="karte">
      <div class="karte-kopf"><h2 style="margin:0">Unsere Termine</h2></div>
      <p class="leise">Aus diesen Spielen entstehen die Catering-Liste (Heimspiele) und der Trikot-Waschplan (alle Spiele).</p>
      ${k.length ? `<ul class="liste">${k.map(zeile).join("")}</ul>` : `<p class="leer">Keine kommenden Spiele eingetragen.</p>`}
      ${v.length ? `<details class="abstand"><summary>Vergangene Spiele (${v.length})</summary><ul class="liste">${v.reverse().map(zeile).join("")}</ul></details>` : ""}
      <div class="nur-kasse abstand">
        <h3>Spiel hinzufügen</h3>
        <form class="zeile" data-form="spiel">
          <div class="feld"><label>Datum</label><input type="date" name="datum" required></div>
          <div class="feld" style="flex-basis:110px"><label>Anwurf</label><input type="time" name="zeit"></div>
          <div class="feld"><label>Gegner</label><input type="text" name="gegner" required maxlength="80"></div>
          <div class="feld"><label>Halle</label><input type="text" name="halle" maxlength="80"></div>
          <div class="feld" style="flex-basis:130px"><label>Art</label><select name="heim"><option value="true">Heimspiel</option><option value="false">Auswärts</option></select></div>
          <div class="feld" style="flex-basis:100%"><label>Hinweis (optional)</label><input type="text" name="hinweis" maxlength="300" placeholder="z. B. Treffpunkt 13:45 Uhr"></div>
          <button class="knopf">Hinzufügen</button>
        </form>
      </div>
    </section>
  </div>`;
}

let offeneSpiele = null; // welche Heimspiel-Karten aufgeklappt sind
const meinName = () => gemerkterName().trim();

function cateringStatus(s) {
  const e = Z.einstellungen;
  const dienst = Z.standdienst.filter((x) => x.spielId === s.id && !x.reserve).length;
  const artikel = e.cateringArtikel.map((a) => ({
    ...a, zugesagt: Z.catering.filter((c) => c.spielId === s.id && c.artikel === a.name).length,
  }));
  const offen = artikel.filter((a) => a.zugesagt < a.bedarf);
  return { dienst: Math.min(dienst, e.standdienstPlaetze), plaetze: e.standdienstPlaetze, artikel, offen, komplett: dienst >= e.standdienstPlaetze && !offen.length };
}
const pill = (ist, soll, text = `${ist}/${soll}`) =>
  `<span class="pill ${ist >= soll ? "ok" : "offen"}">${ist >= soll ? "✓ " : ""}${text}</span>`;

function seiteCatering() {
  const e = Z.einstellungen;
  const liste = heimspiele();
  const k = kommende(liste), v = vergangene(liste);
  if (offeneSpiele === null) offeneSpiele = new Set(k.length ? [k[0].id] : []);

  const uebersicht = k.length ? `<section class="karte">
    <h2>Übersicht: Wo wird noch Hilfe gebraucht?</h2>
    <div class="tabelle-wrap"><table class="uebersicht">
      <thead><tr><th>Heimspiel</th><th><span class="lang">Standdienst</span><span class="kurz">Dienst</span></th>${e.cateringArtikel.map((a) => `<th class="nur-breit">${esc(a.name)}</th>`).join("")}<th class="nur-schmal">Mitbringen</th></tr></thead>
      <tbody>${k.map((s) => {
        const st = cateringStatus(s);
        return `<tr data-aktion="springen" data-id="${s.id}" title="Zum Spiel springen">
          <td><strong>${datum(s.datum).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}</strong><div class="leise klein">${esc(s.gegner)}</div></td>
          <td>${pill(st.dienst, st.plaetze)}</td>
          ${st.artikel.map((a) => `<td class="nur-breit">${pill(a.zugesagt, a.bedarf)}</td>`).join("")}
          <td class="nur-schmal">${pill(st.artikel.length - st.offen.length, st.artikel.length, st.offen.length ? `${st.offen.length} offen` : "komplett")}</td></tr>`;
      }).join("")}</tbody></table></div>
    <p class="leise klein" style="margin:8px 0 0">Zeile antippen, um direkt zum Spiel zu springen.</p>
  </section>` : "";

  const karte = (s) => {
    const st = cateringStatus(s);
    const alle = Z.standdienst.filter((x) => x.spielId === s.id).sort((a, b) => a.erstellt.localeCompare(b.erstellt));
    const dienst = alle.filter((x) => !x.reserve);
    const reserve = alle.filter((x) => x.reserve);
    const frei = Math.max(0, st.plaetze - dienst.length);
    const reserveFrei = Math.max(0, (e.reservePlaetze ?? 1) - reserve.length);
    const eintrag = (d) => `<li><span><span class="haken">✓</span><strong>${esc(d.name)}</strong>${d.hinweis ? ` <span class="leise">· ${esc(d.hinweis)}</span>` : ""}</span>
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
          <div class="artikel-name"><strong>${esc(a.name)}</strong> ${pill(a.zugesagt, a.bedarf)}${a.hinweis ? `<span class="leise klein artikel-hinweis">je ${esc(a.hinweis)}</span>` : ""}</div>
          <button class="${voll ? "link-knopf" : "knopf klein zweit"}" data-aktion="mitbringen-oeffnen" data-key="${key}">${voll ? "+ zusätzlich" : "Ich bringe mit"}</button>
        </div>
        ${zusagen.length ? `<div>${zusagen.map((c) => `<span class="chip">${esc(c.name)}${c.menge ? " · " + esc(c.menge) : ""}${darfLoeschen(c) ? `<button class="x" title="entfernen" data-aktion="loeschen" data-col="catering" data-id="${c.id}" data-frage="Zusage entfernen?">×</button>` : `<span style="width:6px"></span>`}</span>`).join("")}</div>` : ""}
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
    return `<details class="karte spiel-karte" data-spiel="${s.id}" id="spiel-${s.id}" ${offeneSpiele.has(s.id) ? "open" : ""}>
      <summary><div class="summary-innen">${spielZeile(s)}<div class="summary-status">${status}</div></div></summary>
      <div class="raster-2 abstand">
        <div><h3>Standdienst</h3>
          <p class="info-zeile">⏰ ${treffzeit(s) ? `Bitte spätestens um <strong>${treffzeit(s)} Uhr</strong> da sein.` : `Bitte mindestens ${Z.einstellungen.standdienstVorlauf ?? 60} Minuten vor Anpfiff da sein.`} ${esc(Z.einstellungen.standdienstInfo || "")}</p>
          <ul class="liste">${plaetze}</ul>
          ${reservePlaetze ? `<h3 class="abstand" style="margin-bottom:2px">Reserve</h3>
          <p class="leise klein" style="margin:0 0 4px">Springt ein, wenn jemand ausfällt.</p>
          <ul class="liste">${reservePlaetze}</ul>` : ""}</div>
        <div><h3>Mitbringliste</h3><ul class="liste">${artikel}</ul></div>
      </div>
      <div class="karte-fuss"><button class="knopf zweit klein" data-aktion="whatsapp-catering" data-spiel="${s.id}">📲 Text für WhatsApp</button>
        <span class="leise klein">Fertiger Text mit allem, was noch fehlt</span></div>
    </details>`;
  };

  return `${kopfzeile("Standdienst und Mitbringliste", "Heimspiel-Catering")}
  <div class="hinweis info">${AUSTRAGEN_HINWEIS}</div>
  ${uebersicht}
  <div class="abstand">${k.length ? k.map(karte).join("") : `<section class="karte"><p class="leer">Kein kommendes Heimspiel eingetragen.</p></section>`}</div>
  ${v.length ? `<details class="abstand"><summary>Vergangene Heimspiele (${v.length})</summary><div class="abstand">${[...v].reverse().map(karte).join("")}</div></details>` : ""}`;
}

function seiteTrikots() {
  const plan = trikotPlan();
  const fam = familien();
  const naechstes = plan.find((p) => !p.erledigt && p.spiel.datum >= heute());
  return `${kopfzeile("Reihum, jede Familie ist dran", "Trikots waschen")}
  <div class="hinweis info">Die Reihenfolge ergibt sich aus dem Kader. Nach jedem Spiel nimmt die eingetragene Familie den Trikotsatz mit und bringt ihn zum nächsten Training gewaschen zurück. Wer nicht kann, tauscht einfach mit einer anderen Familie und ändert es hier.</div>
  ${fam.length < 2 ? `<div class="hinweis">Es sind erst ${fam.length} Spieler im Kader eingetragen. Die Kassenführung ergänzt den Kader unter Verwaltung, dann verteilt sich der Plan automatisch.</div>` : ""}
  <section class="karte">
    ${plan.length ? `<div class="tabelle-wrap"><table>
      <thead><tr><th>Spiel</th><th>Familie</th><th>Erledigt</th><th></th></tr></thead>
      <tbody>${plan.map((p) => `<tr class="${p.erledigt ? "erledigt" : ""} ${p === naechstes ? "naechstes" : ""}">
        <td><strong>${datumKurz(p.spiel.datum)}</strong><div class="leise">${p.spiel.heim ? "Heim" : "Auswärts"} gegen ${esc(p.spiel.gegner)}</div></td>
        <td><strong>${esc(p.familie)}</strong>${p.getauscht ? ` <span class="leise klein">(getauscht)</span>` : ""}</td>
        <td><input type="checkbox" aria-label="erledigt" data-aktion="trikot-erledigt" data-id="${p.spiel.id}" ${p.erledigt ? "checked" : ""}></td>
        <td><select class="klein" data-aktion="trikot-tausch" data-id="${p.spiel.id}" aria-label="Familie ändern" style="padding:5px 8px;font-size:13px;width:auto">
          <option value="">${p.getauscht ? "Ursprüngliche Familie" : "Familie ändern …"}</option>
          ${fam.filter((f) => f !== p.familie).map((f) => `<option>${esc(f)}</option>`).join("")}</select></td>
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
  <section class="karte abstand nur-kasse">
    <h2 id="buchung-titel">Einzelne Buchung erfassen</h2>
    <form class="zeile" data-form="kasse">
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
  </section>

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
    <div class="hinweis">Bitte nur Fotos hochladen, mit denen die abgebildeten Kinder und deren Eltern einverstanden sind. Keine Fotos aus der Umkleide, keine peinlichen Situationen. Fotos werden vor dem Hochladen verkleinert, Standortdaten werden dabei entfernt.</div>
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
  return `${kopfzeile("Nur für die Kassenführung", "Verwaltung")}
  <div class="raster-2">
    <section class="karte">
      <h2>Kader (nur Vornamen)</h2>
      <p class="leise">Die Reihenfolge bestimmt den Trikot-Waschplan.</p>
      <ul class="liste">${kader().map((k) => `<li><span>${k.reihenfolge}. <strong>${esc(k.vorname)}</strong>${k.nummer ? ` <span class="leise">#${esc(k.nummer)}</span>` : ""}</span>
        <button class="link-knopf" style="color:var(--rot)" data-aktion="loeschen" data-col="kader" data-id="${k.id}" data-frage="${esc(k.vorname)} aus dem Kader entfernen?">entfernen</button></li>`).join("")}</ul>
      <form class="zeile abstand" data-form="kader">
        <div class="feld"><label>Vorname</label><input type="text" name="vorname" required maxlength="30"></div>
        <div class="feld" style="flex-basis:80px"><label>Nr.</label><input type="text" name="nummer" maxlength="3"></div>
        <div class="feld" style="flex-basis:90px"><label>Reihenf.</label><input type="number" name="reihenfolge" value="${kader().length + 1}"></div>
        <button class="knopf">Hinzufügen</button>
      </form>
    </section>
    <section class="karte">
      <h2>Einstellungen</h2>
      <form data-form="einstellungen">
        <div class="ausrichten">
          <div class="feld"><label>Anfangsbestand (€)</label><input type="text" name="anfangsbestand" inputmode="decimal" value="${(e.anfangsbestand / 100).toFixed(2).replace(".", ",")}"></div>
          <div class="feld"><label>Stichtag</label><input type="date" name="anfangsdatum" value="${esc(e.anfangsdatum)}"></div>
          <div class="feld"><label>Standdienst-Plätze pro Heimspiel</label><input type="number" min="1" max="10" name="standdienstPlaetze" value="${e.standdienstPlaetze}"></div>
          <div class="feld"><label>Reserveplätze</label><input type="number" min="0" max="5" name="reservePlaetze" value="${e.reservePlaetze ?? 1}"></div>
        </div>
        <div class="ausrichten abstand">
          <div class="feld" style="flex-basis:200px"><label>Standdienst da sein (Minuten vor Anpfiff)</label><input type="number" min="0" max="180" name="standdienstVorlauf" value="${e.standdienstVorlauf ?? 60}"></div>
        </div>
        <label>Infotext Standdienst</label><textarea name="standdienstInfo" style="min-height:70px" maxlength="400">${esc(e.standdienstInfo || "")}</textarea>
        <label class="schalter abstand"><input type="checkbox" name="galerieAktiv" ${e.galerieAktiv ? "checked" : ""}> Galerie für Eltern freigeben</label>
        <div>
        </div>
        <label class="abstand">Liga</label><input type="text" name="liga" value="${esc(e.liga)}">
        <label class="abstand">Text zur Mannschaft</label><textarea name="teamText">${esc(e.teamText)}</textarea>
        <label class="abstand">Trainingszeiten (je Zeile: Tag | Uhrzeit | Halle)</label>
        <textarea name="trainingszeiten" style="min-height:70px">${esc(e.trainingszeiten.map((t) => `${t.tag} | ${t.zeit} | ${t.halle}`).join("\n"))}</textarea>
        <label class="abstand">Mitbringliste (je Zeile: Artikel | Anzahl | Menge je Zusage)</label>
        <textarea name="cateringArtikel" style="min-height:110px">${esc(e.cateringArtikel.map((a) => `${a.name} | ${a.bedarf}${a.hinweis ? " | " + a.hinweis : ""}`).join("\n"))}</textarea>
        <label class="abstand">Kassen-Kategorien (eine pro Zeile)</label>
        <textarea name="kassenKategorien" style="min-height:90px">${esc(e.kassenKategorien.join("\n"))}</textarea>
        <label class="abstand">Zahlungskanäle (einer pro Zeile)</label>
        <textarea name="kassenKanaele" style="min-height:70px">${esc(e.kassenKanaele.join("\n"))}</textarea>
        <label class="abstand">handball.net Widget-Token (optional)</label>
        <input type="text" name="widgetToken" value="${esc(e.widgetToken)}" placeholder="z. B. 585937e1379b81a963168635">
        <p class="leise klein">Zu finden auf handball.net im Reiter Spielplan der Mannschaft unter „Füge den Spielplan deiner Website hinzu“.</p>
        <label>Link zur Mannschaft auf handball.net</label>
        <input type="text" name="handballNetUrl" value="${esc(e.handballNetUrl)}">
        <button class="knopf abstand">Einstellungen speichern</button>
      </form>
    </section>
  </div>
  <p class="unterzeile abstand">Trainerteam</p>
  <div class="raster abstand" style="margin-top:8px">
    ${trainer.map((t) => `<section class="karte"><form data-form="trainer" data-id="${t.id}">
      <label>Name</label><input type="text" name="name" value="${esc(t.name)}" maxlength="80" required>
      <div class="ausrichten abstand" style="margin-top:8px">
        <div class="feld"><label>Rolle</label><input type="text" name="rolle" value="${esc(t.rolle)}" maxlength="60"></div>
        <div class="feld" style="flex-basis:80px"><label>Reihenf.</label><input type="number" name="reihenfolge" value="${t.reihenfolge}"></div>
      </div>
      <label class="abstand" style="margin-top:8px">Text</label><textarea name="text" maxlength="1500">${esc(t.text)}</textarea>
      <div class="ausrichten abstand" style="margin-top:8px"><button class="knopf klein">Speichern</button>
        <button type="button" class="knopf klein gefahr" data-aktion="loeschen" data-col="trainer" data-id="${t.id}" data-frage="Trainer entfernen?">Entfernen</button></div>
    </form></section>`).join("")}
    <section class="karte"><form data-form="trainer-neu">
      <h3>Trainer hinzufügen</h3>
      <label>Name</label><input type="text" name="name" maxlength="80" required>
      <label class="abstand" style="margin-top:8px">Rolle</label><input type="text" name="rolle" value="Trainer" maxlength="60">
      <button class="knopf klein abstand">Hinzufügen</button>
    </form></section>
  </div>`;
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
  const dienst = alle.filter((x) => !x.reserve).map((x) => x.name);
  const reserve = alle.filter((x) => x.reserve).map((x) => x.name);
  const frei = Math.max(0, e.standdienstPlaetze - dienst.length);
  const z = [`🤾 Heimspiel ${wtDatum(s)}${s.zeit ? " " + s.zeit + " Uhr" : ""} gegen ${s.gegner}`];
  if (s.halle) z.push(`📍 ${s.halle}`);
  z.push("", `👕 Standdienst${treffzeit(s) ? ` (bitte spätestens um ${treffzeit(s)} Uhr da sein)` : ""}:`);
  z.push(dienst.length ? `${frei ? "" : "✅ "}${dienst.join(", ")}` : "");
  if (frei) z.push(`❗ noch ${frei} ${frei === 1 ? "Platz" : "Plätze"} frei`);
  if ((e.reservePlaetze ?? 1) > 0) z.push(reserve.length ? `Reserve: ${reserve.join(", ")}` : "Reserve: noch frei");
  z.push("", "🍰 Mitbringliste:");
  for (const a of e.cateringArtikel) {
    const zus = Z.catering.filter((c) => c.spielId === s.id && c.artikel === a.name);
    const wer = zus.map((c) => (c.menge ? `${c.menge} von ` : "") + c.name).join(", ");
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
        <td style="text-align:right"><button class="link-knopf" data-aktion="whatsapp-abrechnung" data-spiel="${s.id}">📲 teilen</button></td>
      </tr>`).join("")}</tbody></table></div>
  </section>`;
}

function abrechnungsFormular() {
  const e = Z.einstellungen;
  const liste = heimspiele();
  const vorschlag = [...vergangene(liste)].reverse().find((s) => !spielBilanz(s.id).anzahl) || kommende(liste)[0];
  const opt = (l, wert) => l.map((x) => `<option ${x === wert ? "selected" : ""}>${esc(x)}</option>`).join("");
  return `<section class="karte abstand nur-kasse">
    <h2>Heimspiel abrechnen</h2>
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
    </form>
  </section>`;
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
let offeneFahrten = null;
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
    <p class="abstand" style="margin-bottom:4px"><strong>${st.fahrten.length ? `${st.fahrten.length} Fahrer, ${st.frei} ${st.frei === 1 ? "Platz" : "Plätze"} frei` : "Noch keine Fahrgemeinschaft"}</strong></p>
    <a class="knopf" href="#/fahrten">Mitfahren oder Plätze anbieten</a></section>`;
}

function fahrtenText(s) {
  const st = fahrtStatus(s);
  const z = [`🚗 Fahrgemeinschaften Auswärtsspiel ${wtDatum(s)}${s.zeit ? " " + s.zeit + " Uhr" : ""} bei ${s.gegner}`];
  if (s.halle) z.push(`📍 ${s.halle}`);
  z.push("");
  if (!st.fahrten.length) z.push("❗ Bisher bietet noch niemand Plätze an.");
  for (const f of st.fahrten) {
    const mit = Z.mitfahrer.filter((m) => m.fahrtId === f.id).map((m) => m.name);
    const frei = f.plaetze - mit.length;
    z.push(`${f.fahrer}${f.treffpunkt ? " · " + f.treffpunkt : ""}: ${mit.length ? mit.join(", ") : "noch niemand"}${frei > 0 ? ` (noch ${frei} frei)` : " (voll)"}`);
  }
  z.push("", `Eintragen: ${location.origin}/#/fahrten`);
  return z.join("\n");
}

function seiteFahrten() {
  const liste = auswaertsspiele();
  const k = kommende(liste), v = vergangene(liste);
  if (offeneFahrten === null) offeneFahrten = new Set(k.length ? [k[0].id] : []);
  const karte = (s) => {
    const st = fahrtStatus(s);
    const vergeben = new Set(Z.mitfahrer.filter((m) => st.fahrten.some((f) => f.id === m.fahrtId)).map((m) => m.name));
    const kinder = kader().map((x) => x.vorname).filter((n) => !vergeben.has(n));
    const fahrten = st.fahrten.map((f) => {
      const mit = Z.mitfahrer.filter((m) => m.fahrtId === f.id).sort((a, b) => a.erstellt.localeCompare(b.erstellt));
      const frei = f.plaetze - mit.length;
      return `<li class="fahrt">
        <div class="fahrt-kopf">
          <div><strong>🚗 ${esc(f.fahrer)}</strong> <span class="pill ${frei > 0 ? "ok" : "neutral"}">${frei > 0 ? `${frei} von ${f.plaetze} frei` : "voll"}</span>
            ${f.treffpunkt ? `<div class="leise klein">Treffpunkt: ${esc(f.treffpunkt)}</div>` : ""}
            ${f.hinweis ? `<div class="leise klein">${esc(f.hinweis)}</div>` : ""}</div>
          ${darfLoeschen(f) ? `<button class="link-knopf" style="color:var(--rot)" data-aktion="loeschen" data-col="fahrten" data-id="${f.id}" data-frage="Fahrt löschen? Eingetragene Mitfahrer werden mit entfernt.">Fahrt löschen</button>` : ""}
        </div>
        <div>${mit.map((m) => `<span class="chip">${esc(m.name)}${darfLoeschen(m) ? `<button class="x" title="austragen" data-aktion="loeschen" data-col="mitfahrer" data-id="${m.id}" data-frage="${esc(m.name)} austragen?">×</button>` : `<span style="width:6px"></span>`}</span>`).join("")}</div>
        ${frei > 0 ? `<form class="zeile mitfahren" data-form="mitfahrer" data-fahrt="${f.id}">
          <div class="feld"><select name="name" aria-label="Kind auswählen">${kinder.length ? `<option value="">Kind auswählen …</option>${kinder.map((n) => `<option ${n === meinKind() ? "selected" : ""}>${esc(n)}</option>`).join("")}` : `<option value="">alle Kinder eingetragen</option>`}<option value="__andere">jemand anderes …</option></select></div>
          <button class="knopf klein">Mitfahren</button></form>` : ""}
      </li>`;
    }).join("");
    const status = st.fahrten.length
      ? `<span class="pill neutral">${st.fahrten.length} Fahrer</span> <span class="pill ${st.frei > 0 ? "ok" : "offen"}">${st.frei > 0 ? `${st.frei} ${st.frei === 1 ? "Platz" : "Plätze"} frei` : "alle Plätze belegt"}</span>`
      : `<span class="pill offen">Noch keine Fahrt</span>`;
    return `<details class="karte spiel-karte" data-gruppe="fahrten" data-spiel="${s.id}" id="fahrt-${s.id}" ${offeneFahrten.has(s.id) ? "open" : ""}>
      <summary><div class="summary-innen">${spielZeile(s)}<div class="summary-status">${status}</div></div></summary>
      <div class="fahrt-inhalt">
        ${fahrten ? `<ul class="liste">${fahrten}</ul>` : `<p class="leer">Noch bietet niemand Plätze an.</p>`}
        <details class="abstand"><summary>Ich fahre und habe Plätze frei</summary>
          <form class="zeile" data-form="fahrt" data-spiel="${s.id}">
            <div class="feld" style="flex-basis:110px"><label>Freie Plätze</label><select name="plaetze">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select></div>
            <div class="feld" style="flex-basis:240px"><label>Treffpunkt und Uhrzeit</label><input type="text" name="treffpunkt" maxlength="120" placeholder="z. B. 13:00 Uhr Parkplatz OTV-Halle"></div>
            <div class="feld" style="flex-basis:200px"><label>Hinweis</label><input type="text" name="hinweis" maxlength="160" placeholder="optional, z. B. nur Hinfahrt"></div>
            <button class="knopf">Fahrt anbieten</button>
          </form></details>
      </div>
      <div class="karte-fuss"><button class="knopf zweit klein" data-aktion="whatsapp-fahrten" data-spiel="${s.id}">📲 Text für WhatsApp</button>
        <span class="leise klein">Übersicht der Fahrten für die Gruppe</span></div>
    </details>`;
  };
  return `${kopfzeile("Gemeinsam zu den Auswärtsspielen", "Fahrgemeinschaften")}
  <div class="hinweis info">Wer fährt, bietet Plätze an. Wer mitfahren möchte, trägt sein Kind bei einer Fahrt ein. ${AUSTRAGEN_HINWEIS}</div>
  ${k.length ? k.map(karte).join("") : `<section class="karte"><p class="leer">Kein kommendes Auswärtsspiel eingetragen.</p></section>`}
  ${v.length ? `<details class="abstand"><summary>Vergangene Auswärtsspiele (${v.length})</summary><div class="abstand">${[...v].reverse().map(karte).join("")}</div></details>` : ""}`;
}


// ---------- Willkommen und Name ----------
function installHinweis() {
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return "";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return `<p class="tipp">📱 <strong>Tipp:</strong> Unten in Safari auf <strong>Teilen</strong> tippen und <strong>„Zum Home-Bildschirm“</strong> wählen. Dann ist die Seite wie eine App auf dem Handy.</p>`;
  if (/Android/.test(ua)) return `<p class="tipp">📱 <strong>Tipp:</strong> Oben rechts im Chrome-Menü <strong>⋮</strong> auf <strong>„App installieren“</strong> oder <strong>„Zum Startbildschirm hinzufügen“</strong> tippen.</p>`;
  return "";
}

function willkommen({ nurName = false } = {}) {
  return new Promise((fertig) => {
    const box = document.createElement("div");
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.innerHTML = `<form class="dialog-box">
      ${nurName ? `<h2>Wie heißt du?</h2><p class="leise">Damit die anderen sehen, wer sich eingetragen hat.</p>`
        : `<h2>Willkommen! 👋</h2>
        <p>Hier organisieren wir Eltern alles rund um die Spiele der C-Jugend: Standdienst, Kuchen, Fahrten, Trikots und Kasse.</p>
        <ul class="punkte-liste">
          <li>Eintragen geht mit einem Klick, austragen genauso.</li>
          <li>Was du zugesagt hast, steht auf der Startseite unter <strong>Meine Termine</strong>.</li>
          <li>Absprachen laufen weiter über WhatsApp.</li>
        </ul>`}
      <label for="w-name">Dein Vorname</label>
      <input id="w-name" type="text" maxlength="40" required value="${esc(meinVorname())}" placeholder="z. B. Peggy" autocomplete="given-name">
      <label for="w-kind" class="abstand" style="margin-top:12px">Dein Kind in der Mannschaft</label>
      <select id="w-kind"><option value="">bitte wählen …</option>${kader().map((k) => `<option ${k.vorname === meinKind() ? "selected" : ""}>${esc(k.vorname)}</option>`).join("")}</select>
      ${nurName ? "" : installHinweis()}
      <div class="ausrichten abstand" style="margin-top:16px">
        <button class="knopf gross">${nurName ? "Weiter" : "Los geht’s"}</button>
        <button type="button" class="link-knopf" data-w="spaeter">später</button>
      </div></form>`;
    const schliessen = (wert) => { lokal("otv_willkommen", "1"); box.remove(); fertig(wert); };
    box.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const vorname = box.querySelector("#w-name").value.trim();
      const kind = box.querySelector("#w-kind").value;
      if (!vorname) return;
      lokal("otv_vorname", vorname);
      lokal("otv_kind", kind);
      lokal("otv_name", kind ? `${vorname} (${kind})` : vorname);
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
  $("#hallo").textContent = v ? `👤 ${v}` : "Name eintragen";
  $("#hallo").title = "Name ändern";
  const galerieSichtbar = Z && (Z.einstellungen.galerieAktiv || istAdmin());
  document.body.classList.toggle("ohne-galerie", !galerieSichtbar);
}

function mehrMenue() {
  const box = document.createElement("div");
  box.className = "lightbox sheet-hinter";
  const links = [
    ["#/kasse", "💶", "Mannschaftskasse"], ["#/trikots", "👕", "Trikots waschen"], ["#/mannschaft", "👥", "Mannschaft"],
    ...(Z.einstellungen.galerieAktiv || istAdmin() ? [["#/galerie", "📷", "Galerie"]] : []),
    ...(istAdmin() ? [["#/verwaltung", "⚙️", "Verwaltung"]] : []),
  ];
  box.innerHTML = `<div class="sheet">
    ${links.map(([h, i, t]) => `<a href="${h}"><span>${i}</span>${t}</a>`).join("")}
    <button data-m="name"><span>✏️</span>Name ändern</button>
    <button data-m="hilfe"><span>❓</span>Hilfe und App-Tipp</button>
    <a href="#/datenschutz"><span>🔒</span>Datenschutz</a>
    <button data-m="abmelden"><span>🚪</span>Abmelden</button>
  </div>`;
  box.addEventListener("click", async (e) => {
    const t = e.target.closest("a,button");
    if (e.target === box || t?.tagName === "A") return box.remove();
    if (!t) return;
    box.remove();
    if (t.dataset.m === "name" || t.dataset.m === "hilfe") { await willkommen({ nurName: t.dataset.m === "name" }); zeigen(); }
    if (t.dataset.m === "abmelden") { await fetch("/api/logout", { method: "POST" }); location.href = "/login.html"; }
  });
  document.body.appendChild(box);
}

// ---------- Router ----------
function zeigen() {
  const pfad = location.hash.replace(/^#\/?/, "").split("?")[0];
  const seite = SEITEN[pfad] || seiteStart;
  inhalt.innerHTML = seite();
  document.querySelectorAll(".nav a, .unten-nav a").forEach((a) => a.classList.toggle("aktiv", a.getAttribute("href") === "#/" + pfad));
  $("#unten-mehr").classList.toggle("aktiv", !["", "catering", "fahrten", "spiele"].includes(pfad));
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
      case "spiel":
        await api("POST", "/api/c/spiele", { ...w, heim: w.heim === "true" });
        await neuLaden("Spiel hinzugefügt"); break;
      case "standdienst":
        await api("POST", "/api/c/standdienst", { ...w, spielId: form.dataset.spiel });
        await neuLaden("Danke, du bist eingetragen"); break;
      case "catering": {
        const name = await nameSicherstellen();
        offeneSpiele?.add(form.dataset.spiel);
        await api("POST", "/api/c/catering", { ...w, name, spielId: form.dataset.spiel });
        await neuLaden("Danke für die Zusage"); break;
      }
      case "fahrt": {
        const name = await nameSicherstellen();
        offeneFahrten?.add(form.dataset.spiel);
        await api("POST", "/api/c/fahrten", { ...w, fahrer: name, plaetze: Number(w.plaetze), spielId: form.dataset.spiel });
        await neuLaden("Danke, deine Fahrt ist eingetragen"); break;
      }
      case "mitfahrer": {
        let kind = w.name;
        if (kind === "__andere") kind = (prompt("Wer fährt mit? (nur Vorname)") || "").trim();
        if (!kind) throw new Error("Bitte ein Kind auswählen");
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
          standdienstVorlauf: w.standdienstVorlauf,
          standdienstInfo: w.standdienstInfo,
          liga: w.liga,
          teamText: w.teamText,
          trainingszeiten: zeilen(w.trainingszeiten).map((z) => { const [tag, zeit, halle] = z.split("|").map((x) => (x || "").trim()); return { tag, zeit, halle }; }),
          cateringArtikel: zeilen(w.cateringArtikel).map((z) => { const [name, bedarf] = z.split("|").map((x) => (x || "").trim()); return { name, bedarf: Math.max(1, parseInt(bedarf, 10) || 1), hinweis: (z.split("|")[2] || "").trim() }; }),
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
      await api("DELETE", `/api/c/${el.dataset.col}/${el.dataset.id}`);
      await neuLaden("Entfernt");
    } else if (a === "standdienst-ich") {
      const name = await nameSicherstellen();
      offeneSpiele?.add(el.dataset.spiel);
      el.disabled = true;
      await api("POST", "/api/c/standdienst", { spielId: el.dataset.spiel, name, reserve: el.dataset.reserve === "1" });
      await neuLaden(el.dataset.reserve ? "Danke, du bist als Reserve eingetragen" : "Danke, du bist eingetragen");
    } else if (a === "mitbringen-liste") {
      const box = $("#mitbringen-auswahl");
      box.hidden = !box.hidden;
      el.setAttribute("aria-expanded", String(!box.hidden));
      if (!box.hidden) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else if (a === "bringe-schnell") {
      const name = await nameSicherstellen();
      el.disabled = true;
      await api("POST", "/api/c/catering", { spielId: el.dataset.spiel, artikel: el.dataset.artikel, name, menge: "" });
      await neuLaden(`Danke, du bringst ${el.dataset.artikel} mit`);
    } else if (a === "kalender") {
      kalenderLaden(el.dataset.alle ? meineTermine() : meineTermine().filter((t) => t.key === el.dataset.key));
    } else if (a === "kassen-details") {
      kassenDetails = !kassenDetails; zeigen();
    } else if (a === "mitbringen-oeffnen") {
      const f = inhalt.querySelector(`form[data-key="${el.dataset.key}"]`);
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector("input[name=menge]").focus();
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
      f.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (a === "buchung-abbrechen") {
      setTimeout(() => { $("#buchung-titel").textContent = "Buchung erfassen"; inhalt.querySelector('form[data-form="kasse"]').elements.id.value = ""; });
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
  const menge = d.dataset.gruppe === "fahrten" ? offeneFahrten : offeneSpiele;
  if (!menge) return;
  if (d.open) menge.add(d.dataset.spiel); else menge.delete(d.dataset.spiel);
}, true);

inhalt.addEventListener("change", async (ev) => {
  const el = ev.target;
  try {
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
window.addEventListener("hashchange", () => { zeigen(); window.scrollTo(0, 0); });

laden().then(() => {
  zeigen();
  if (!lokal("otv_willkommen") && !meinName()) willkommen().then(() => zeigen());
}).catch((e) => {
  inhalt.innerHTML = `<div class="hinweis">Die Seite konnte nicht geladen werden: ${esc(e.message)}</div>`;
});
