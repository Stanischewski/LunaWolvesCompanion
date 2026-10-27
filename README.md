# Luna Wolves Companion

Begleit-Plattform zum WoW-Addon [LunaWolves](https://github.com/Stanischewski/LunaWolves).
Sie macht die Gildendaten aus dem Spiel dauerhaft verfügbar — im Web, über
Discord und über einen kleinen Agent auf dem PC.

## Download

### Desktop-Agent (Windows)

**[⬇ LunaWolvesAgent-Setup.exe herunterladen](https://github.com/Stanischewski/LunaWolvesCompanion/releases/latest/download/LunaWolvesAgent-Setup.exe)**

Der Link zeigt immer auf die neueste Fassung — er muss nach einem Release
nicht angepasst werden.

Alternativ als MSI, etwa für eine verteilte Installation:
[LunaWolvesAgent.msi](https://github.com/Stanischewski/LunaWolvesCompanion/releases/latest/download/LunaWolvesAgent.msi)

Alle Fassungen mit Änderungsliste: [Releases](https://github.com/Stanischewski/LunaWolvesCompanion/releases)

> Windows SmartScreen meldet sich beim ersten Start, weil der Installer kein
> kostenpflichtiges Code-Signing-Zertifikat trägt: **Weitere Informationen →
> Trotzdem ausführen**. Der Agent prüft seine eigenen Updates dagegen sehr
> wohl kryptografisch — `latest.json` ist signiert und wird gegen einen
> einkompilierten Schlüssel geprüft.

### Addon

**[⬇ LunaWolves.zip herunterladen](https://github.com/Stanischewski/LunaWolves/releases/latest/download/LunaWolves.zip)**

Entpacken und den Ordner `LunaWolves` nach
`World of Warcraft/_retail_/Interface/AddOns/` kopieren.

Einfacher: Der Desktop-Agent installiert und aktualisiert das Addon selbst.

## Was der Agent tut

World of Warcraft schreibt die Daten des Addons beim Ausloggen in eine
`SavedVariables`-Datei. Der Agent liest sie und lädt sie zum Server — anders
kämen DKP-Stände und Roster nie aus dem Spiel heraus. Außerdem hält er das
Addon aktuell.

Nach der Installation: mit Battle.net anmelden, den WoW-Ordner bestätigen,
fertig. Das Anmelde-Token liegt im Windows-Anmeldeinformationsspeicher, nicht
in einer Datei.

## Aufbau

| Teil | Technik | Aufgabe |
|---|---|---|
| `apps/api` | Fastify, PostgreSQL | Datenhaltung, Battle.net- und Discord-Anmeldung, Sync-Endpunkt |
| `apps/web` | Next.js | Dashboard, Roster, DKP, Raids |
| `apps/bot` | discord.js | Slash-Befehle, DKP im Discord, Raid-Ankündigungen |
| `apps/desktop` | Tauri, Rust | der Agent oben |
| `packages/lua-parser` | TypeScript | liest die `SavedVariables` des Addons |

## Selbst betreiben

Alles Nötige steht in **[`deploy/lxc/README.md`](deploy/lxc/README.md)**:
ein App-Container mit API, Bot und Web unter PM2, dazu ein bestehender
PostgreSQL-Container.

Zwei Dinge, an denen ein Deploy sonst scheitert:

- Die Rechteprüfung ist **fail closed**. Ohne `ADMIN_DISCORD_ROLE_ID` und
  `OFFICER_ROLE_IDS` kann niemand DKP buchen — auch kein Officer.
- `JWT_SECRET` bei einem Neuaufbau **aufbewahren**. Ein neuer Wert macht jeden
  ausgegebenen Token ungültig, der Agent antwortet dann mit
  `401 Nicht authentifiziert` und muss sich neu anmelden.

## Entwicklung

```bash
pnpm install
pnpm run build
pnpm test
```

pnpm-Workspaces mit Turbo, Node 22. Weitere Unterlagen in
[`docs/DOCS_INDEX.md`](docs/DOCS_INDEX.md).
