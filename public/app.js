// Elternseite OTV männliche C-Jugend: Single-Page-App ohne Framework.

// ---------- Grundlagen ----------
const $ = (sel, el = document) => el.querySelector(sel);
const inhalt = $("#inhalt");
let Z = null; // Gesamtzustand vom Server
let galerie = [];
let galerieGeladen = false;
let albumFilter = "Alle";
let kassenFilter = "alle";

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

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = (cent) => (cent / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const heute = () => new Date().toISOString().slice(0, 10);
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
const kopfzeile = (unter, titel) => `<p class="unterzeile">${unter}</p><h1>${titel}</h1>`;

// ---------- Seiten ----------
const SEITEN = {
  "": seiteStart,
  mannschaft: seiteMannschaft,
  spiele: seiteSpiele,
  catering: seiteCatering,
  trikots: seiteTrikots,
  kasse: seiteKasse,
  galerie: seiteGalerie,
  verwaltung: seiteVerwaltung,
  datenschutz: seiteDatenschutz,
};

function seiteStart() {
  const naechstes = kommende(spieleSortiert())[0];
  const naechstesHeim = kommende(heimspiele())[0];
  const { saldo } = kassenSummen();
  const plan = trikotPlan();
  const trikot = plan.find((p) => !p.erledigt && p.spiel.datum >= heute()) || plan.find((p) => !p.erledigt);
  let standdienstInfo = `<p class="leer">Kein Heimspiel eingetragen.</p>`;
  if (naechstesHeim) {
    const belegt = Z.standdienst.filter((x) => x.spielId === naechstesHeim.id).length;
    const frei = Z.einstellungen.standdienstPlaetze - belegt;
    const artikelOffen = Z.einstellungen.cateringArtikel.filter((a) =>
      Z.catering.filter((c) => c.spielId === naechstesHeim.id && c.artikel === a.name).length < a.bedarf).map((a) => a.name);
    standdienstInfo = `${spielZeile(naechstesHeim)}
      <p class="abstand" style="margin-bottom:4px"><strong>${frei > 0 ? `${frei} Standdienst-Platz${frei === 1 ? "" : "plätze"} frei` : "Standdienst komplett besetzt"}</strong></p>
      <p class="leise">${artikelOffen.length ? "Noch offen: " + artikelOffen.map(esc).join(", ") : "Mitbringliste ist komplett."}</p>
      <a class="knopf" href="#/catering">Eintragen</a>`;
  }
  return `${kopfzeile("Willkommen im Elternbereich", "OTV männliche C-Jugend")}
  <div class="raster">
    <section class="karte"><div class="kachel-label">Nächstes Spiel</div>
      ${naechstes ? spielZeile(naechstes) : `<p class="leer">Noch kein Spiel eingetragen.</p>`}
      <p class="abstand"><a href="#/spiele">Alle Spiele und Tabelle</a></p></section>
    <section class="karte"><div class="kachel-label">Nächstes Heimspiel-Catering</div>${standdienstInfo}</section>
    <section class="karte"><div class="kachel-label">Mannschaftskasse</div>
      <div class="zahl-gross ${saldo < 0 ? "minus" : ""}">${euro(saldo)}</div>
      <p class="leise">aktueller Kassenstand</p>
      <a href="#/kasse">Kassenbericht ansehen</a></section>
    <section class="karte"><div class="kachel-label">Trikots waschen</div>
      ${trikot ? `<div class="zahl-gross" style="font-size:24px">${esc(trikot.familie)}</div>
        <p class="leise">nach dem Spiel am ${datumKurz(trikot.spiel.datum)} gegen ${esc(trikot.spiel.gegner)}</p>`
        : `<p class="leer">Noch keine Spiele oder Familien eingetragen.</p>`}
      <a href="#/trikots">Zum Waschplan</a></section>
  </div>`;
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
const meinName = () => (document.getElementById("mein-name")?.value || gemerkterName()).trim();

function cateringStatus(s) {
  const e = Z.einstellungen;
  const dienst = Z.standdienst.filter((x) => x.spielId === s.id).length;
  const artikel = e.cateringArtikel.map((a) => ({
    ...a, zugesagt: Z.catering.filter((c) => c.spielId === s.id && c.artikel === a.name).length,
  }));
  const offen = artikel.filter((a) => a.zugesagt < a.bedarf);
  return { dienst, plaetze: e.standdienstPlaetze, artikel, offen, komplett: dienst >= e.standdienstPlaetze && !offen.length };
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
    const dienst = Z.standdienst.filter((x) => x.spielId === s.id).sort((a, b) => a.erstellt.localeCompare(b.erstellt));
    const frei = Math.max(0, st.plaetze - dienst.length);
    const plaetze = [
      ...dienst.map((d) => `<li><span><span class="haken">✓</span><strong>${esc(d.name)}</strong>${d.hinweis ? ` <span class="leise">· ${esc(d.hinweis)}</span>` : ""}</span>
        ${darfLoeschen(d) ? `<button class="link-knopf" data-aktion="loeschen" data-col="standdienst" data-id="${d.id}" data-frage="Eintrag entfernen?">austragen</button>` : ""}</li>`),
      ...Array.from({ length: frei }, () => `<li><span class="platz-frei">Platz frei</span>
        <button class="knopf klein" data-aktion="standdienst-ich" data-spiel="${s.id}">Ich übernehme</button></li>`),
    ].join("");
    const artikel = st.artikel.map((a, i) => {
      const zusagen = Z.catering.filter((c) => c.spielId === s.id && c.artikel === a.name);
      const voll = a.zugesagt >= a.bedarf;
      const key = `${s.id}-${i}`;
      return `<li style="display:block">
        <div class="artikel-zeile">
          <div class="artikel-name"><strong>${esc(a.name)}</strong> ${pill(a.zugesagt, a.bedarf)}</div>
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
        <div><h3>Standdienst</h3><ul class="liste">${plaetze}</ul></div>
        <div><h3>Mitbringliste</h3><ul class="liste">${artikel}</ul></div>
      </div>
    </details>`;
  };

  return `${kopfzeile("Standdienst und Mitbringliste", "Heimspiel-Catering")}
  <div class="name-leiste karte">
    <label for="mein-name">Dein Name für Eintragungen</label>
    <input id="mein-name" type="text" maxlength="60" value="${esc(gemerkterName())}" placeholder="z. B. Peggy (Mama von Piet)">
    <p class="leise klein" style="margin:6px 0 0">Wird auf diesem Gerät gemerkt. Eigene Einträge kannst du hier wieder entfernen.</p>
  </div>
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
          <option value="">${p.getauscht ? "Reihenfolge wiederherstellen" : "tauschen mit …"}</option>
          ${fam.filter((f) => f !== p.familie).map((f) => `<option>${esc(f)}</option>`).join("")}</select></td>
      </tr>`).join("")}</tbody></table></div>`
      : `<p class="leer">Noch keine Spiele eingetragen.</p>`}
  </section>`;
}

function seiteKasse() {
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
  <div class="raster">
    <section class="karte"><div class="kachel-label">Kassenstand</div><div class="zahl-gross ${saldo < 0 ? "minus" : ""}">${euro(saldo)}</div>
      <p class="leise" style="margin:0">Anfangsbestand ${euro(e.anfangsbestand)} am ${datumKurz(e.anfangsdatum)}</p></section>
    <section class="karte"><div class="kachel-label">Einnahmen</div><div class="zahl-gross" style="color:var(--gruen)">${euro(ein)}</div></section>
    <section class="karte"><div class="kachel-label">Ausgaben</div><div class="zahl-gross" style="color:var(--rot)">${euro(aus)}</div></section>
  </div>
  <div class="raster-2 abstand">
    <section class="karte"><h2>Einnahmen nach Kanal</h2>${balken(gruppe("einnahme", "kanal"), ein, "var(--gruen)")}</section>
    <section class="karte"><h2>Ausgaben nach Zweck</h2>${balken(gruppe("ausgabe", "kategorie"), aus, "var(--rot)")}</section>
  </div>

  <section class="karte abstand nur-kasse">
    <h2 id="buchung-titel">Buchung erfassen</h2>
    <form class="zeile" data-form="kasse">
      <input type="hidden" name="id">
      <div class="feld" style="flex-basis:150px"><label>Datum</label><input type="date" name="datum" required value="${heute()}"></div>
      <div class="feld" style="flex-basis:130px"><label>Art</label><select name="art"><option value="einnahme">Einnahme</option><option value="ausgabe">Ausgabe</option></select></div>
      <div class="feld" style="flex-basis:120px"><label>Betrag (€)</label><input type="text" name="betrag" inputmode="decimal" required placeholder="0,00"></div>
      <div class="feld" style="flex-basis:260px"><label>Zweck</label><input type="text" name="zweck" required maxlength="120" placeholder="z. B. Catering Heimspiel gegen BHC III"></div>
      <div class="feld"><label>Kategorie</label><select name="kategorie">${opt(e.kassenKategorien)}</select></div>
      <div class="feld"><label>Kanal</label><select name="kanal">${opt(e.kassenKanaele)}</select></div>
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
      <thead><tr><th>Datum</th><th>Zweck</th><th>Kanal</th><th class="betrag">Betrag</th><th class="betrag">Stand</th><th class="nur-kasse"></th></tr></thead>
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
        </div>
        <label class="abstand">Liga</label><input type="text" name="liga" value="${esc(e.liga)}">
        <label class="abstand">Text zur Mannschaft</label><textarea name="teamText">${esc(e.teamText)}</textarea>
        <label class="abstand">Trainingszeiten (je Zeile: Tag | Uhrzeit | Halle)</label>
        <textarea name="trainingszeiten" style="min-height:70px">${esc(e.trainingszeiten.map((t) => `${t.tag} | ${t.zeit} | ${t.halle}`).join("\n"))}</textarea>
        <label class="abstand">Mitbringliste (je Zeile: Artikel | Anzahl benötigt)</label>
        <textarea name="cateringArtikel" style="min-height:110px">${esc(e.cateringArtikel.map((a) => `${a.name} | ${a.bedarf}`).join("\n"))}</textarea>
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

// ---------- Router ----------
function zeigen() {
  const pfad = location.hash.replace(/^#\/?/, "").split("?")[0];
  const seite = SEITEN[pfad] || seiteStart;
  inhalt.innerHTML = seite();
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("aktiv", a.getAttribute("href") === "#/" + pfad));
  $("#nav").classList.remove("offen");
  $("#menue-knopf").setAttribute("aria-expanded", "false");
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
        const name = meinName();
        if (!name) { $("#mein-name").focus(); throw new Error("Bitte oben zuerst deinen Namen eintragen"); }
        lokal("otv_name", name);
        offeneSpiele?.add(form.dataset.spiel);
        await api("POST", "/api/c/catering", { ...w, name, spielId: form.dataset.spiel });
        await neuLaden("Danke für die Zusage"); break;
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
          liga: w.liga,
          teamText: w.teamText,
          trainingszeiten: zeilen(w.trainingszeiten).map((z) => { const [tag, zeit, halle] = z.split("|").map((x) => (x || "").trim()); return { tag, zeit, halle }; }),
          cateringArtikel: zeilen(w.cateringArtikel).map((z) => { const [name, bedarf] = z.split("|").map((x) => (x || "").trim()); return { name, bedarf: Math.max(1, parseInt(bedarf, 10) || 1) }; }),
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
      const name = meinName();
      if (!name) { $("#mein-name").focus(); meldung("Bitte oben zuerst deinen Namen eintragen", true); return; }
      lokal("otv_name", name);
      offeneSpiele?.add(el.dataset.spiel);
      el.disabled = true;
      await api("POST", "/api/c/standdienst", { spielId: el.dataset.spiel, name });
      await neuLaden("Danke, du bist eingetragen");
    } else if (a === "mitbringen-oeffnen") {
      const f = inhalt.querySelector(`form[data-key="${el.dataset.key}"]`);
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector("input[name=menge]").focus();
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
  if (!d.classList?.contains("spiel-karte") || !offeneSpiele) return;
  if (d.open) offeneSpiele.add(d.dataset.spiel); else offeneSpiele.delete(d.dataset.spiel);
}, true);
inhalt.addEventListener("input", (ev) => {
  if (ev.target.id === "mein-name") lokal("otv_name", ev.target.value.trim());
});

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
  const zeilenCsv = [["Datum", "Art", "Betrag", "Zweck", "Kategorie", "Kanal", "Spiel", "Beleg", "Kassenstand"]];
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
$("#menue-knopf").addEventListener("click", () => {
  const offen = $("#nav").classList.toggle("offen");
  $("#menue-knopf").setAttribute("aria-expanded", String(offen));
});
$("#abmelden").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login.html";
});
window.addEventListener("hashchange", () => { zeigen(); window.scrollTo(0, 0); });

laden().then(zeigen).catch((e) => {
  inhalt.innerHTML = `<div class="hinweis">Die Seite konnte nicht geladen werden: ${esc(e.message)}</div>`;
});
