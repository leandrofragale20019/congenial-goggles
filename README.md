# Promille-Uhr

Eine kleine Web-App, die den Blutalkohol (‰) schätzt. Du gibst ein, was du wann getrunken hast,
dazu Geschlecht, Alter, Gewicht, Grösse, wie voll dein Magen ist und eine Abbaurate.
Die App ist fürs Smartphone gebaut und bewusst schlicht:

- **Startseite (`index.html`)**: oben gross der aktuelle Promillewert mit Status
  («nicht fahren», «Neulenker nicht fahren», «fast nüchtern», «nüchtern»), ob er noch steigt,
  und wann du unter 0,5 ‰, unter 0,1 ‰ und bei 0,0 ‰ bist. Darunter Knöpfe zum Hinzufügen
  von Getränken mit einem Tipp und die Liste des Getrunkenen (zum Bearbeiten antippen, mit
  «Rückgängig» nach dem Löschen). Verlaufskurve und Körperdaten sind einklappbar.
- **Infoseite (`info.html`)**: Notfall-Box zur Alkoholvergiftung, Kater-Tipps,
  kurze Erklärung der Rechnung und Grenzwerte.

Alles wird alle 30 Sekunden neu berechnet. Die Eingaben bleiben im `localStorage` des Browsers
gespeichert und verlassen dein Gerät nie.

> **Nur eine Schätzung.** Fahre nie auf Basis dieser App Auto.

## Starten

`index.html` im Browser öffnen (Doppelklick). Es braucht keinen Server, keinen Build und keine
Abhängigkeiten.

Tests (Node.js ab Version 18):

```sh
node calc.test.js
```

## Dateien

| Datei          | Inhalt                                                             |
|----------------|--------------------------------------------------------------------|
| `index.html`   | Startseite: Promillewert, Getränke, Verlauf, Angaben               |
| `info.html`    | Notfall, Kater-Tipps, Erklärungen                                  |
| `style.css`    | Gestaltung, alle Farben als CSS-Variablen, Hell- und Dunkelmodus   |
| `app.js`       | Oberfläche: Eingaben, Speichern, Anzeige, SVG-Kurve                |
| `calc.js`      | Berechnung als reine Funktionen (ohne DOM), im Browser und in Node |
| `calc.test.js` | Tests für `calc.js`                                                |

## Formeln

1. **Gramm Alkohol** = cl × 10 × (Vol-% / 100) × 0,789
2. **Körperwasser nach Watson** (Liter)
   - Mann: 2,447 − 0,09516 × Alter + 0,1074 × Grösse(cm) + 0,3362 × Gewicht(kg)
   - Frau: −2,097 + 0,1069 × Grösse(cm) + 0,2466 × Gewicht(kg)
3. **‰ pro Gramm** = 0,8 / (1,055 × Körperwasser)
   (0,8 = Wasseranteil des Blutes, 1,055 = Dichte des Blutes)
4. **Resorptionsdefizit** (Anteil, der nie im Blut ankommt): Magen leer 10 %, etwas gegessen 15 %,
   Mahlzeit 25 %
5. **Aufnahme**: jedes Getränk wird linear aufgenommen, über 30 min (leer), 60 min (etwas)
   bzw. 90 min (Mahlzeit)
6. **Simulation** in 5-Minuten-Schritten ab dem ersten Getränk:
   Wert += in diesem Schritt aufgenommener Alkohol, Wert −= Abbaurate / 12, nie unter 0.
   Sie läuft, bis alles aufgenommen ist und der Wert 0 erreicht.
7. Aus dem Verlauf: aktueller Wert (interpoliert), Höchstwert + Uhrzeit, und die Zeitpunkte,
   an denen der Wert **zuletzt** unter 0,5 ‰ bzw. 0,1 ‰ fällt und 0,0 ‰ erreicht
   (zwischen zwei Schritten linear interpoliert).

Uhrzeiten, die mehr als 30 Minuten in der Zukunft liegen, gelten als gestern
(Getränke vor Mitternacht).

## Grenzen der Schätzung

- Die Formeln beschreiben einen **Durchschnittsmenschen**. Leber, Medikamente, Müdigkeit,
  Krankheit, Gewöhnung und Genetik können den echten Wert stark verändern.
- Die Abbaurate liegt meist zwischen 0,10 und 0,20 ‰ pro Stunde und ist individuell.
  Wer es nicht weiss, sollte mit 0,10 rechnen (vorsichtigste Annahme).
- Das Modell zieht den Abbau ab der ersten Minute ab, auch während der Aufnahme. Dadurch liegt
  der Höchstwert tiefer als bei der klassischen Widmark-Formel. Beispiel aus den Tests:
  Mann, 25 J., 180 cm, 75 kg, etwas gegessen, 2 × 30 cl Bier + 4 cl Schnaps auf einmal
  → Widmark ohne Abbau ≈ 0,52 ‰, diese Simulation ≈ 0,37 ‰.
- Ein einzelnes kleines Getränk wird im Modell langsamer aufgenommen als abgebaut und erscheint
  darum gar nicht. Bei einem Mann mit 75 kg liegt diese Schwelle bei etwa 5 g (Magen leer),
  10 g (etwas gegessen) bzw. 18 g (Mahlzeit) – ein Glas Wein nach dem Essen zeigt also 0,00 ‰.
  In Wirklichkeit steigt der Wert kurz an.
- Bei Jugendlichen, sehr leichten oder sehr schweren Personen ist die Watson-Formel ungenauer.
- Der gesetzliche Wert wird in der Schweiz mit Atem- oder Bluttests bestimmt, nie mit einer App.

**Wer getrunken hat, fährt nicht.** Notfall: 144 (Sanität), 112, 145 (Tox Info Suisse).
