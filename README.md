# Elternseite OTV männliche C-Jugend

Passwortgeschützte Webseite für die Eltern der männlichen C-Jugend des Ohligser TV 1888.
Hosting über GitHub und Netlify (Gratis-Tarif), Daten in Netlify Blobs. Kein Framework und kein Build-Schritt.

## Inhalt

| Bereich | Wer darf was |
|---|---|
| Start | Übersicht: nächstes Spiel, nächstes Heimspiel-Catering, Kassenstand, wer die Trikots wäscht |
| Mannschaft | Text, Liga, Kader (nur Vornamen), Trainer, Trainingszeiten. Ändern nur Kasse |
| Spiele | handball.net-Widget (Spielplan, Tabelle) und eigene Terminliste. Termine pflegt die Kasse |
| Heimspiel-Catering | Pro Heimspiel Standdienst (Plätze begrenzt) und Mitbringliste. Alle Eltern tragen sich ein und entfernen nur ihre eigenen Einträge. 2 feste Plätze plus Reserve. Knopf „Text für WhatsApp“ |
| Fahrten | Fahrgemeinschaften zu Auswärtsspielen: Plätze anbieten, Kinder eintragen, WhatsApp-Text |
| Trikots | Waschplan reihum nach Kader, Tausch und „erledigt“ durch alle Eltern |
| Kasse | Alle sehen Stand, Buchungen, Einnahmen nach Kanal, Ausgaben nach Zweck, CSV-Export, Ergebnis je Heimspiel. Buchen nur Kasse, inklusive „Heimspiel abrechnen“ mit fertigem WhatsApp-Text |
| Galerie | Alle laden Fotos hoch (werden im Browser verkleinert, Standortdaten entfernt). Melden blendet ein Foto sofort aus, die Kasse gibt frei oder löscht |
| Verwaltung | Nur Kasse: Kader, Trainer, Anfangsbestand, Mitbringliste, Kategorien, Widget-Token |

Zwei Passwörter: Das **Eltern-Passwort** erlaubt Lesen und Eintragen. Das **Kassen-Passwort** (nur Tomski und Peggy) erlaubt zusätzlich Buchungen und Verwaltung.

## Einrichtung

1. Ordnerinhalt in ein neues privates GitHub-Repository hochladen.
2. In Netlify: *Add new site → Import an existing project* → Repository wählen. Build-Befehl leer lassen, Publish-Verzeichnis `public` (steht schon in `netlify.toml`).
3. Unter *Site configuration → Environment variables* drei Variablen anlegen:
   - `ELTERN_PASSWORT`: Passwort für die Eltern
   - `KASSE_PASSWORT`: Passwort für die Kassenführung, deutlich anders als das Eltern-Passwort
   - `SESSION_SECRET`: lange Zufallszeichenfolge (mindestens 32 Zeichen), z. B. aus einem Passwortmanager
4. Neu deployen. Beim ersten Aufruf legt die Seite Startdaten an (Anfangsbestand 850 €, Trainer, Trainingszeiten, Heimspiel am 10.10.2026).
5. Mit dem Kassen-Passwort anmelden, unter **Verwaltung** den Kader mit Vornamen eintragen und unter **Spiele** die weiteren Termine ergänzen.

Netlify Blobs braucht keine eigene Einrichtung, der Speicher entsteht automatisch mit der Seite.

## handball.net-Widget

Auf handball.net die Mannschaft öffnen, im Reiter Spielplan „Füge den Spielplan deiner Website hinzu“ anklicken und den Token aus dem angezeigten Code unter **Verwaltung** eintragen. Ohne Token zeigt die Seite einen Link zu handball.net.

Hinweis: Die eigene Terminliste unter **Spiele** speist Catering und Trikotplan. Sie wird nicht automatisch aus handball.net gefüllt, weil handball.net dafür keine offene Schnittstelle anbietet.

## Passwort wechseln

Variable in Netlify ändern und neu deployen. Wer schon angemeldet ist, bleibt angemeldet. Um alle abzumelden, zusätzlich `SESSION_SECRET` ändern. Empfehlung: zu jeder neuen Saison beide Passwörter und das Secret wechseln.

## Grenzen, die man kennen sollte

- Ein gemeinsames Passwort heißt: Wer es hat, kommt rein. Es gibt keine Einzelkonten und kein Protokoll, wer was eingetragen hat.
- „Eigene Einträge“ werden über eine zufällige Kennung im Browser erkannt. Wer Browserdaten löscht oder das Gerät wechselt, kann alte Einträge nicht mehr selbst entfernen, die Kasse aber schon.
- Fotos können heruntergeladen und weitergegeben werden. Das lässt sich technisch nicht verhindern.
- Vor dem Start der Galerie die Einwilligung der Eltern einholen und mit der Jugendleitung bzw. dem Schutzkonzept des OTV abstimmen.

## Dateien

```
public/                 Webseite (HTML, CSS, JS, Logo, Schriften lokal, kein Google Fonts)
netlify/edge-functions/ schutz.js: Passwortschutz für jede Anfrage
netlify/functions/      api.mjs: Login, Daten, Galerie
netlify/shared/         session.js: signiertes Anmelde-Cookie
netlify.toml            Konfiguration, noindex und Sicherheits-Header
```

## Als App auf dem Handy

iPhone: Seite in Safari öffnen, Teilen, „Zum Home-Bildschirm“. Android: Chrome-Menü, „Zum Startbildschirm hinzufügen“ bzw. „App installieren“.
