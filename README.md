# Elternseite OTV männliche C-Jugend

Passwortgeschützte Webseite für die Eltern der männlichen C-Jugend des Ohligser TV 1888.
Hosting über GitHub und Netlify (Gratis-Tarif), Daten in Netlify Blobs. Kein Framework und kein Build-Schritt.

## Inhalt

| Bereich | Wer darf was |
|---|---|
| Start | Die zwei nächsten Spiele: Heimspiel mit „Ich übernehme Standdienst“ und „Ich bringe etwas mit“, Auswärtsspiel mit Fahrern, freien Plätzen und „Kind fährt mit“. Darunter „Meine Termine“ mit Kalender-Export. Auf dem Handy ein Hinweis zur App-Installation |
| Infos & Termine | Das Trainerteam schreibt kurze Infos (z. B. Trainingsausfall), die auf der Startseite stehen, bis sie ablaufen. Abfragen wie „Wer ist in den Herbstferien beim Training?“: Eltern kreuzen für ihren Sohn an, Trainer und Kasse sehen die Übersicht und können Antworten aus WhatsApp direkt in der Tabelle antippen. Termine (z. B. Weihnachtsfeier) mit Rückmeldefrist stehen auf derselben Seite. Der WhatsApp-Text pro Spiel (Startseite, für Trainer und Kasse) enthält aktuelle Trainer-Infos und offene Rückmeldungen |
| Mannschaft | Text, Liga, Kader (nur Vornamen), Trainer, Trainingszeiten. Ändern nur Kasse |
| Spiele | Kalender-Abo (webcal-Link mit allen Spielen und Mannschaftsterminen, ohne Namen; Kasse kann den Link in der Verwaltung erneuern). handball.net-Widget (Spielplan, Tabelle) und eigene Terminliste. Termine pflegt die Kasse |
| Heimspiel-Catering | Artikel mit „bei Bedarf“ (z. B. Kaffee) stehen nur auf der Liste, wenn die Kasse sie beim Spiel zuschaltet. Pro Heimspiel Standdienst (Plätze begrenzt) und Mitbringliste. Alle Eltern tragen sich ein und entfernen nur ihre eigenen Einträge. 2 feste Plätze plus Reserve. Knopf „Text für WhatsApp“ |
| Vorrat und Wäsche | Auf der Catering-Seite: Kaffee, Milch, Zucker, Becher, Spülmittel mit „reicht / knapp / leer“. Was knapp oder leer ist, steht automatisch auf der Mitbringliste fürs nächste Heimspiel. Wäsche: pro Heimspiel trägt sich jemand ein, der Geschirrtücher und Spüllappen danach mitnimmt, wäscht und zum nächsten Heimspiel mitbringt. Die Kasse kann die Anzahl je Artikel pro Spiel mit − / + ändern |
| Zeitnehmer | Bei jedem Spiel (einstellbar: alle oder nur Heimspiele) eine Zeile „Zeitnehmer: noch offen / Name“ mit „Ich mache das“. Orange wenn offen, rot ab 7 Tage vorher. WhatsApp-Text unter Spiele |
| Termine | Feiern, Elternabende usw. Eltern sagen für ihre Familie zu oder ab und geben zusätzliche Personen an. Die Kasse trägt Antworten aus WhatsApp in „Rückmeldungen verwalten“ ein und bucht Zahlungen direkt in die Kasse |
| Fahrten | Fahrgemeinschaften zu Auswärtsspielen: Plätze anbieten, Jungs eintragen, WhatsApp-Text |
| Trikots | Waschplan reihum nach Kader, Tausch und „erledigt“ durch alle Eltern |
| Kasse | Eltern sehen zuerst nur Kassenstand und letzte Buchungen, Details auf Knopfdruck. Alle sehen Stand, Buchungen, Einnahmen nach Kanal, Ausgaben nach Zweck, CSV-Export, Ergebnis je Heimspiel. Buchen nur Kasse, inklusive „Heimspiel abrechnen“ mit fertigem WhatsApp-Text |
| Galerie | Erst sichtbar, wenn die Kasse sie unter Verwaltung freigibt. Dann laden alle Fotos hoch (werden im Browser verkleinert, Standortdaten entfernt). Melden blendet ein Foto sofort aus, die Kasse gibt frei oder löscht |
| Verwaltung | Nur Kasse: Hallen mit Adresse (daraus der Knopf „Route“), Trainingszeiten, Kader, Trainer, Anfangsbestand, Mitbringliste, Vorrat, Wäsche, Zeitnehmer, Kategorien, Widget-Token. Dazu die Helfer-Übersicht (wer hat wie oft Standdienst, Mitbringen, Fahren, Zeitnehmer, Trikots übernommen), gezählt über den Sohn in Klammern hinter dem Namen |

Drei Passwörter: Das **Eltern-Passwort** erlaubt Lesen und Eintragen. Das **Trainer-Passwort** kann alles wie das Eltern-Passwort und zusätzlich Infos, Termine und Abfragen anlegen und bearbeiten (Zahlungen buchen bleibt bei der Kasse). Das **Kassen-Passwort** (nur Tomski und Peggy) erlaubt zusätzlich Buchungen und Verwaltung.

## Einrichtung

1. Ordnerinhalt in ein neues privates GitHub-Repository hochladen.
2. In Netlify: *Add new site → Import an existing project* → Repository wählen. Build-Befehl leer lassen, Publish-Verzeichnis `public` (steht schon in `netlify.toml`).
3. Unter *Site configuration → Environment variables* drei Variablen anlegen:
   - `ELTERN_PASSWORT`: Passwort für die Eltern
   - `KASSE_PASSWORT`: Passwort für die Kassenführung, deutlich anders als das Eltern-Passwort
   - `TRAINER_PASSWORT` (optional): Passwort für das Trainerteam
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

## Bedienung für Eltern

Beim ersten Besuch fragt die Seite einmal nach Vorname und Kind und zeigt einen Tipp, wie man sie als App ablegt. Auf dem Handy liegt die Navigation unten (Start, Catering, Fahrten, Spiele, Mehr). Unter „Mehr“ liegen Kasse, Trikots, Mannschaft und Galerie. Name und Kind lassen sich über den Namen oben rechts oder „Mehr“ ändern.
