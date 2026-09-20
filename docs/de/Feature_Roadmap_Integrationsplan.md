# Feature-Roadmap — Aktivitätenfeed, M+-Tracking, Handwerksaufträge, DKP-Auktionen

Machbarkeitsanalyse und Umsetzungsplan für vier gewünschte Erweiterungen, aufbauend auf dem Stand vom 2026-09-20 (`4281dec` / `809e651`).

Aufbau wie in den bestehenden Plänen (`Addon_DKP_Integrationsplan.md`, `SIMC_Integrationsplan.md`): erst Machbarkeit und Datenquellen, dann Schema, dann Umsetzung je Komponente.

> **Hinweis zu WoW-API-Angaben:** Funktionen und Events sind nach bestem Wissen benannt, aber Blizzard ändert die Signaturen zwischen Erweiterungen. Jede mit ⚠️ markierte Stelle sollte vor der Umsetzung einmal im Spiel gegengeprüft werden (`/dump`), bevor Aufwand hineinfließt.

---

## 0. Übersicht und Reihenfolge

| # | Feature | Machbarkeit | Addon nötig? | Aufwand | Abhängig von |
|---|---------|-------------|--------------|---------|--------------|
| 1 | Aktivitätenfeed | **hoch** — Fundament existiert | nein (erweitert sich mit) | M | — |
| 2 | M+-Läufe mit Gildengruppe | **hoch** — ohne Addon machbar | optional (Stufe 2) | M | 1 |
| 3 | Gilden-Handwerksaufträge | **eingeschränkt** — siehe [3.1](#31-die-entscheidende-einschränkung) | ja, zwingend | M | 1 |
| 4 | DKP-Gebote und Itemvergabe | **hoch** — größter Brocken | ja, zwingend | L | DKP-Fixes |

**Empfohlene Reihenfolge:** 1 → 2 → 4 → 3.

Der Aktivitätenfeed kommt zuerst, weil die anderen drei Features ihre Ereignisse dort einspeisen — ohne ihn entsteht dreimal dieselbe Infrastruktur. M+ folgt, weil es ohne eine Zeile Lua auskommt und damit den schnellsten sichtbaren Nutzen bringt. Die Handwerksaufträge stehen hinten, weil ihr Nutzen als Einziges an einer Einschränkung hängt, die sich nicht wegprogrammieren lässt.

> **Vorbedingung für Feature 4:** Die DKP-Auktion baut direkt auf `DKP:Spend()` und `/dkp/spend` auf. Solange [A1](Code_Review_2026-09.md#a1) (jeder Nutzer darf DKP buchen), [B2](Code_Review_2026-09.md#b2)/[B3](Code_Review_2026-09.md#b3) (Season-Reset hält nicht) und der fehlende Guthaben-Check in `dkp.ts:150` offen sind, setzt eine Auktion echtes Geld auf ein undichtes Fundament. Diese Punkte gehören vorher erledigt.

---

## 1. Aktivitätenfeed

### 1.1 Was bereits da ist

| Baustein | Ort | Zustand |
|----------|-----|---------|
| `activity_logs`-Tabelle | `apps/api/src/db/schema.ts:64-73` | vorhanden, aber nur `eventType: "seen"` wird geschrieben |
| Lese-Endpunkt | `apps/api/src/routes/sync.ts:615-637` | vorhanden, unauthentifiziert ([A6](Code_Review_2026-09.md#a6)) |
| WebSocket-Räume | `apps/api/src/ws/socket.ts` | vorhanden |
| Live-Komponente | `apps/web/app/dashboard/components/LiveFeed.tsx` | vorhanden, verarbeitet aber nur 2 der 4 gesendeten Ereignisse |

Die API sendet bereits `member_seen`, `raid_signup`, `dkp_update` und `dkp_reset`; `LiveFeed.tsx` hört nur auf die ersten beiden. Die letzten beiden gehen heute ins Leere — das ist der billigste Teilerfolg im gesamten Plan.

### 1.2 Zwei Schemaprobleme, die vorher zu lösen sind

**a) `characterId` ist `NOT NULL`.** Gildenweite Ereignisse (ein erstellter Handwerksauftrag, ein Season-Reset, ein abgeschlossener Raid) haben keinen einzelnen Charakter. Nötig:

```ts
export const activityLogs = pgTable("activity_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: uuid("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  characterId: uuid("character_id").references(() => characters.id, { onDelete: "set null" }), // jetzt nullable
  eventType: activityEventTypeEnum("event_type").notNull(),
  eventData: jsonb("event_data"),
  dedupeKey: varchar("dedupe_key", { length: 128 }),   // siehe b)
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  source: activitySourceEnum("source").notNull(),
}, (t) => [
  unique("activity_dedupe").on(t.guildId, t.dedupeKey),
  index("activity_guild_time").on(t.guildId, t.recordedAt.desc()),
]);
```

Das `guildId`-Feld erspart nebenbei den Join über `characters` in `sync.ts:626` und `guilds.ts:117`.

**b) Es gibt keine Deduplizierung.** Sobald mehrere Gildenmitglieder das Addon nutzen, lädt jeder von ihnen dieselben M+-Läufe und Handwerksaufträge hoch. Ohne Idempotenzschlüssel steht jedes Ereignis fünfmal im Feed. `dedupeKey` mit `onConflictDoNothing()` löst das — dasselbe Muster, das `dkp_entries.addonEntryId` schon verwendet (`sync.ts:157`).

**c) Aufbewahrung.** `activity_logs` wächst mit jedem Sync und jedem Mitglied. Heute ist die Tabelle ohne jeden Index ([C6](Code_Review_2026-09.md#c6)) und ohne Löschregel. Vorschlag: Rohereignisse 90 Tage halten, danach auf Tagesaggregate verdichten — der Statistik-Endpunkt in `guilds.ts:110-125` rechnet ohnehin schon auf Tagesbasis.

### 1.3 Ereignistypen

```ts
export const activityEventTypeEnum = pgEnum("activity_event_type", [
  "seen",              // bestehend
  "member_joined",     // Charakter erstmals im Roster
  "member_left",       // fehlt im Snapshot → siehe Review B9
  "rank_changed",
  "level_up",
  "ilvl_up",           // nur ab einer Schwelle, sonst Rauschen
  "mplus_completed",   // Feature 2
  "raid_signup",
  "boss_kill",
  "dkp_award", "dkp_spend", "dkp_reset",
  "loot_awarded",      // Feature 4
  "crafting_order",    // Feature 3
]);
```

Einheitliche `eventData`-Form je Typ, damit die Anzeige generisch bleibt:

```ts
{ type: "mplus_completed",
  data: { dungeon: "Dämmerbrecher", level: 18, timed: true,
          clearTimeMs: 1834000, upgrades: 2,
          members: [{ characterId, name, class }] } }
```

### 1.4 Umsetzung je Komponente

**API**
* `emitActivity(tx, { guildId, characterId?, type, data, dedupeKey?, source })` als einziger Schreibpfad — verhindert, dass jede Route ihr eigenes Format erfindet.
* Der WebSocket bekommt ein einheitliches `activity`-Ereignis zusätzlich zu den bestehenden vier (die bestehenden bleiben für Rückwärtskompatibilität).
* `GET /guilds/:id/activity` um Cursor-Paginierung und `?types=` erweitern, **und authentifizieren** ([A6](Code_Review_2026-09.md#a6)).

**Web**
* `LiveFeed.tsx` auf das generische `activity`-Ereignis umstellen und um `dkp_update`/`dkp_reset` ergänzen — das ist der erwähnte Sofortgewinn.
* Neue Seite `/dashboard/activity` mit Filter nach Typ, Spieler und Zeitraum.
* Pro Ereignistyp eine kleine Render-Komponente; Icons über den bestehenden `ClassIcon`- und `emojis.ts`-Bestand.

**Discord**
* Neuer Kanal, verwaltet wie das DKP-Board: `guildSettings.activityChannelId`, ein Scheduler-Lauf im Muster von `apps/bot/src/dkpBoard.ts`.
* **Wichtig, sonst kippt der Kanal:** nicht jedes Ereignis einzeln posten. Alle 5 Minuten die seit dem letzten Lauf aufgelaufenen Ereignisse sammeln und als *ein* Embed posten. Nur wirklich meldenswerte Einzelereignisse (M+ ab +15, Itemvergabe, Bosskill-Erstkill) bekommen einen eigenen Post.
* Ereignisse, die ein Discord-Konto betreffen, per `players.discordId` verlinken — die Verknüpfung existiert bereits (`auth.ts:186-198`).

**Aufwand:** Schema + API ~1 Tag, Web ~1 Tag, Discord ~0,5 Tage.

---

## 2. M+-Läufe: welche Gildengruppe hat welchen Schlüsselstein geschafft

### 2.1 Die zentrale Erkenntnis

**Das geht ohne eine einzige Zeile Addon-Code.** Raider.IO liefert pro Charakter die letzten Läufe inklusive **Abschlusszeitstempel**. Haben fünf Gildenmitglieder denselben Dungeon, dieselbe Stufe und denselben `completed_at`, dann waren sie zusammen unterwegs. Die Gildengruppe lässt sich also aus bereits verfügbaren Einzeldaten rekonstruieren.

Der bestehende Job `apps/api/src/jobs/raiderio.ts` ruft die API ohnehin schon alle 30 Minuten für jeden Charakter auf — er fragt bisher nur das Feld `mythic_plus_scores_by_season:current` ab. Ein zweites Feld kostet keine zusätzliche Anfrage:

```ts
const fields = [
  "mythic_plus_scores_by_season:current",
  "mythic_plus_recent_runs",
].join(",");
```

Jeder Lauf liefert ⚠️ (Feldnamen im Spiel bzw. gegen die Live-API prüfen):
`dungeon`, `short_name`, `mythic_level`, `completed_at`, `clear_time_ms`, `par_time_ms`, `num_keystone_upgrades`, `affixes`, `score`, `url`.

### 2.2 Ehrliche Grenzen der Raider.IO-Variante

| Grenze | Auswirkung | Abmilderung |
|--------|-----------|-------------|
| Nur die letzten ~10 Läufe pro Charakter | Bei Vielspielern gehen Läufe verloren, wenn der Job zu selten läuft | Job auf 30 Minuten belassen; das reicht auch für Marathonabende |
| Nur Charaktere, die Raider.IO kennt | Frisch transferierte oder sehr inaktive Chars fehlen | Aufnahme erfolgt automatisch nach dem ersten gewerteten Lauf |
| Keine Gruppenmitglieder außerhalb der Gilde | Der Feed zeigt „3 Gildenmitglieder" statt der ganzen Gruppe | Bewusste Entscheidung — es ist ein *Gilden*-Feed |
| `completed_at` ist sekundengenau | Theoretisch könnten zwei getrennte Gruppen kollidieren | Zusätzlich über `clear_time_ms` und `mythic_level` gruppieren; Kollision praktisch ausgeschlossen |
| Abgebrochene/nicht abgeschlossene Läufe fehlen | „Key zerschossen" taucht nicht auf | Nur mit Addon lösbar (Stufe 2) |

### 2.3 Stufe 2 — Addon-Erfassung (optional, exakt)

Wenn exakte Gruppen inklusive Nicht-Gildenmitglieder und abgebrochener Läufe gewünscht sind, liefert der Client die Daten direkt:

* Event `CHALLENGE_MODE_COMPLETED` ⚠️
* `C_ChallengeMode.GetChallengeCompletionInfo()` → `mapChallengeModeID`, `level`, `time`, `onTime`, `keystoneUpgradeLevels`, `practiceRun` ⚠️
* `C_ChallengeMode.GetMapUIInfo(mapID)` → Dungeonname ⚠️
* Gruppenzusammensetzung über `GetNumGroupMembers()` + `UnitName("party1".."party4")` zum Zeitpunkt des Abschlusses, plus `UnitClass`.

Ablage in `LunaWolvesDB.MythicPlus` analog zur DKP-History, Upload über den bestehenden Sync-Pfad. Die Ereignis-ID (`mapId-level-completedAt`) dient gleichzeitig als `dedupeKey` — damit vertragen sich Stufe 1 und Stufe 2 ohne Doppeleinträge, und Raider.IO bleibt der Rückfallpfad für Mitglieder ohne Addon.

**Empfehlung:** Mit Stufe 1 starten. Sie liefert ~90 % des Nutzens für ~20 % des Aufwands, und die Datenbank sieht beide Quellen identisch.

### 2.4 Schema

```ts
export const mplusRuns = pgTable("mplus_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: uuid("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  dungeonId: integer("dungeon_id").notNull(),        // map_challenge_mode_id
  dungeonName: varchar("dungeon_name", { length: 128 }).notNull(),
  level: integer("level").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  clearTimeMs: integer("clear_time_ms"),
  parTimeMs: integer("par_time_ms"),
  upgrades: integer("upgrades").notNull().default(0), // 0 = nicht getimed
  affixes: jsonb("affixes").$type<string[]>(),
  season: varchar("season", { length: 32 }),
  source: varchar("source", { length: 16 }).notNull(), // "raiderio" | "addon"
}, (t) => [
  unique("mplus_run_key").on(t.guildId, t.dungeonId, t.level, t.completedAt),
  index("mplus_guild_time").on(t.guildId, t.completedAt.desc()),
]);

export const mplusRunMembers = pgTable("mplus_run_members", {
  runId: uuid("run_id").notNull().references(() => mplusRuns.id, { onDelete: "cascade" }),
  characterId: uuid("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  role: raidRoleEnum("role"),
}, (t) => [primaryKey({ columns: [t.runId, t.characterId] })]);
```

Der `unique`-Schlüssel ist genau das Zusammenführungskriterium: Meldet Raider.IO denselben Lauf über fünf verschiedene Charaktere, entsteht **eine** Zeile in `mplus_runs` und fünf in `mplus_run_members`. Die Gruppenrekonstruktion ist damit ein Nebeneffekt des Schemas und braucht keinen eigenen Algorithmus.

### 2.5 Anzeige

**Web** — `/dashboard/mplus`:
* „Gildengruppen dieser Woche" — Läufe mit ≥ 2 Gildenmitgliedern, absteigend nach Stufe
* Bestenliste je Dungeon (höchste getimte Stufe, wer war dabei)
* Pro Charakter: Verlauf, höchste Stufe, Score (letzterer kommt bereits aus `characters.mPlusScore`)
* Filter „nur reine Gildengruppen" (alle 5 Teilnehmer in der Gilde)

**Discord**:
* Automatischer Post bei ≥ 3 Gildenmitgliedern und Stufe ≥ 15:
  `🗝️ +18 Dämmerbrecher getimed (+2) — Aiden, Brynja, Caelis, Dorn, Eyla · 24:31`
* `/mplus top [dungeon]` — Bestenliste
* `/mplus week` — Wochenübersicht
* `/mplus player <name>` — Läufe eines Spielers

**Aufwand:** Stufe 1 ~1,5 Tage (Job, Schema, Web, Bot). Stufe 2 zusätzlich ~1 Tag Lua.

---

## 3. Gilden-Handwerksaufträge im Discord-Kanal

### 3.1 Die entscheidende Einschränkung

**Es gibt keine Blizzard-Web-API für Handwerksaufträge.** Die Daten existieren ausschließlich im Spielclient, und zwar über `C_CraftingOrders` ⚠️. Diese Schnittstelle ist anfragebasiert: Sie liefert Aufträge nur, wenn der Spieler die Handwerksauftrags-Oberfläche tatsächlich geöffnet hat (am Handwerkstisch oder beim Auftrags-NSC). Ein Hintergrund-Abruf ist nicht vorgesehen.

Daraus folgt eine harte Aussage, die vor der Umsetzung klar sein muss:

> Ein Feed, der *alle* offenen Gildenaufträge zuverlässig und aktuell anzeigt, ist nicht baubar. Was geht, ist ein Feed, der Aufträge zeigt, sobald ein Gildenmitglied mit Addon sie erstellt oder ansieht.

Wer das ignoriert, baut ein Feature, dem die Gilde nach zwei Wochen nicht mehr vertraut, weil die Hälfte der Aufträge fehlt.

### 3.2 Zwei Pfade — der zweite ist der zuverlässige

**Pfad A — Beobachtung beim Durchblättern (lückenhaft)**

Öffnet ein Mitglied den Gilden-Reiter der Auftragsübersicht, feuern `CRAFTINGORDERS_UPDATE_ORDER_COUNT` bzw. `CRAFTINGORDERS_SHOW_CRAFTER` ⚠️, und `C_CraftingOrders.GetCrafterOrders()` ⚠️ liefert die aktuell geladene Seite. Das Addon speichert sie in `LunaWolvesDB.CraftingOrders`.

*Aktualität:* hängt davon ab, dass jemand nachsieht. Für Berufe, die niemand in der Gilde ausübt, bleibt der Feed dauerhaft leer.

**Pfad B — Erfassung bei der Erstellung (zuverlässig)**

Erstellt ein Mitglied selbst einen Gildenauftrag, feuert auf **seinem** Client `CRAFTINGORDERS_ORDER_PLACEMENT_RESPONSE` ⚠️ mit dem Ergebnis. Dieser Pfad ist deterministisch: Wer das Addon hat und einen Auftrag aufgibt, erzeugt garantiert genau einen Datensatz.

**Die Aufgabenstellung lautet „erstellte Gilden-Handwerksaufträge anzeigen" — das ist exakt Pfad B.** Er sollte die Grundlage sein; Pfad A ergänzt ihn opportunistisch um Aufträge von Mitgliedern ohne Addon.

### 3.3 Der unterschätzte Zusatznutzen: Handwerker-Verzeichnis

Unabhängig von den Aufträgen lässt sich über `C_TradeSkillUI` ⚠️ zuverlässig auslesen, **welche Rezepte und Spezialisierungen ein Charakter beherrscht** — ohne Anfrage-Einschränkung, jederzeit beim Öffnen des Berufsfensters.

Daraus entsteht ein „Wer kann was herstellen"-Verzeichnis im Web und ein `/craft wer <item>` im Discord. Das löst dieselbe Alltagsfrage („Wer kann mir das bauen?") **verlässlicher** als der Auftragsfeed und hat keine Aktualitätsprobleme. Bei begrenzter Zeit ist das der bessere Einstieg in dieses Themenfeld.

### 3.4 Schema

```ts
export const craftingOrders = pgTable("crafting_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: uuid("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  orderId: varchar("order_id", { length: 64 }).notNull(),   // Blizzard-Auftrags-ID
  itemId: integer("item_id").notNull(),
  itemName: varchar("item_name", { length: 256 }),
  itemIconUrl: text("item_icon_url"),                        // über itemIconCache
  quantity: integer("quantity").notNull().default(1),
  profession: varchar("profession", { length: 64 }),
  customerName: varchar("customer_name", { length: 64 }),
  crafterName: varchar("crafter_name", { length: 64 }),      // nach Annahme
  tipCopper: integer("tip_copper"),
  status: craftingOrderStatusEnum("status").notNull(),       // open | claimed | fulfilled | expired
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  observedBy: varchar("observed_by", { length: 64 }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("crafting_order_key").on(t.guildId, t.orderId),
  index("crafting_order_status").on(t.guildId, t.status, t.expiresAt),
]);
```

`itemIconUrl` kann die bereits vorhandene `itemIconCache`-Tabelle und `resolveIconUrl()` aus `jobs/equipment.ts:56-77` wiederverwenden — dort steckt schon die komplette Blizzard-Medien-Logik.

**Statusfortschreibung:** Da Pfad A lückenhaft ist, darf ein Auftrag nicht stillschweigend verschwinden. Regel: Aufträge, deren `expiresAt` verstrichen ist, gehen automatisch auf `expired`. Aufträge, die bei einer *vollständigen* Neuerfassung derselben Seite fehlen, gehen auf `fulfilled`. Aufträge, zu denen es seit 7 Tagen keine Beobachtung gab, werden im Discord-Embed als „Stand: vor X Tagen" gekennzeichnet statt gelöscht.

### 3.5 Anzeige

**Discord** — rollendes Embed im Muster von `dkpBoard.ts`:

```
📋 Offene Gilden-Handwerksaufträge                      Stand: vor 4 Min.

⚒️  Schmiedekunst
    [Ätherisch verstärkter Brustharnisch] ×1 · Trinkgeld 2.500g
    von Brynja · läuft ab in 2 Tg. 4 Std.

🧵  Schneiderei
    [Seidenweberbeinlinge] ×1 · Trinkgeld 1.200g
    von Caelis · läuft ab in 18 Std.            ⚠️ Stand: vor 3 Tagen
```

* Rollennennung pro Beruf über konfigurierbare `professionRoleIds` in `guildSettings` — so bekommt nur der Schmied einen Ping.
* `/craft orders [beruf]` für den Abruf auf Zuruf.
* `/craft wer <item>` für das Verzeichnis aus [3.3](#33-der-unterschätzte-zusatznutzen-handwerker-verzeichnis).

**Web** — `/dashboard/crafting`: Auftragsliste mit Filter, plus Berufsmatrix (Mitglied × Beruf × Fertigkeitsstufe).

**Aufwand:** Addon-Erfassung ~1,5 Tage (bei API-Überraschungen mehr), API + Web + Bot ~1,5 Tage. Das Handwerker-Verzeichnis allein: ~1 Tag.

---

## 4. DKP-Gebote auf Items im Raid und Verteilung

### 4.1 Zielbild

Ein Officer stellt einen erbeuteten Gegenstand zur Versteigerung. Alle Raidmitglieder mit Addon bekommen ein Fenster mit Item, eigenem DKP-Stand und Eingabefeld. Nach Ablauf gewinnt das höchste Gebot, die Punkte werden automatisch abgebucht, der Vorgang landet in DKP-History, Web-Übersicht und Discord. Die Übergabe des Gegenstands erfolgt manuell — **dafür gibt es keine API, und das wird sich nicht ändern.**

### 4.2 Ablauf

```
Officer                        Raid                          Companion
   │                             │                               │
   │ /lw dkp bid [Item] 60       │                               │
   ├─ AUCTION:START ────────────►│  Gebotsfenster öffnet sich    │
   │  (id, itemLink, dauer,      │  zeigt: Item, eigener DKP-    │
   │   minBid, regel)            │  Stand, Eingabefeld           │
   │                             │                               │
   │◄──── BID (WHISPER) ─────────┤  Gebot nur an den Auktionator │
   │  Prüfung gegen lokale       │  (kein Broadcast → kein       │
   │  DKP-Tabelle                │   Mitbieten auf Sicht)        │
   │                             │                               │
   │ Timer läuft ab              │                               │
   ├─ AUCTION:RESULT ───────────►│  Ergebnis für alle sichtbar   │
   │  DKP:Spend(winner, preis)   │                               │
   ├─ normaler DKP-Eintrag ──────┴──── Sync ──────────────────────►│
   │                                                              │ Discord-Post
   │  Officer handelt das Item manuell                            │ Web-Lootliste
```

Der entscheidende Punkt: **Die Abbuchung läuft über den bestehenden `DKP:Spend()`-Pfad** (`DKP.lua:197-200`). Es entsteht ein ganz normaler History-Eintrag vom Typ `SPEND`, der über den vorhandenen Sync im Companion landet. Es braucht keinen zweiten Buchungsweg — und damit auch keine zweite Fehlerquelle.

### 4.3 Gebotsverfahren

Konfigurierbar, weil Gilden hier unterschiedliche Kulturen haben:

| Verfahren | Regel | Wirkung |
|-----------|-------|---------|
| **Höchstgebot** | Gewinner zahlt sein Gebot | einfach, verleitet zum Unterbieten |
| **Zweitpreis (Vickrey)** | Gewinner zahlt zweithöchstes Gebot + 1 | fördert ehrliches Bieten, in DKP-Gilden verbreitet |
| **Festpreis** | Preis pro Item-Kategorie, keine Auktion | am schnellsten, keine Taktik |

Vorschlag: alle drei umsetzen, **Zweitpreis als Voreinstellung**. Der Mehraufwand gegenüber nur einem Verfahren liegt bei wenigen Zeilen in der Auflösungsfunktion.

### 4.4 Die vier Fallstricke

**a) Gebote über dem eigenen Guthaben.** Die Prüfung muss beim **Auktionator** stattfinden, gegen dessen lokale DKP-Tabelle — nicht beim Bietenden. Ein veränderter Client kann sonst beliebige Gebote abgeben. Der Auktionator hat die vollständige Tabelle ohnehin lokal vorliegen, die Prüfung kostet nichts.

**b) Parallele Auktionen.** Läuft ein Bosskill mit drei Items gleichzeitig, kann ein Spieler sein gesamtes Guthaben dreimal bieten und danach im Minus landen. Lösung: pro offener Auktion wird das Höchstgebot des Spielers als *reserviert* geführt; verfügbar ist `current − Summe der laufenden Reservierungen`.

**c) Serverseitig fehlt die Guthabenprüfung komplett.** `apps/api/src/routes/dkp.ts:150-200` bucht jeden `spend` ohne zu prüfen, ob Deckung besteht:

```ts
set: { current: sql`${dkpStandings.current} + ${delta}`, ... }   // kann unter 0 fallen
```

Für eine Auktion ist das nicht tragbar. Entweder eine Prüfung mit `403` bei Unterdeckung oder eine bewusst erlaubte, aber protokollierte Überziehung. Das ist eine kleine Änderung, muss aber vor dem Feature passieren.

**d) Auktionator verliert die Verbindung.** Bricht die Verbindung während einer Auktion ab, ist sie verloren. Abmilderung: `AUCTION:START` und jedes akzeptierte Gebot werden zusätzlich an alle Officers gespiegelt, sodass ein anderer Officer auflösen kann. Ohne diese Spiegelung bleibt nur der Neustart der Auktion — für den Anfang vertretbar, sollte aber dokumentiert sein.

**Gleichstand** wird deterministisch aufgelöst: frühester Zeitstempel gewinnt, danach alphabetisch. Nicht zufällig — bei einem Punktesystem muss jedes Ergebnis nachvollziehbar sein.

### 4.5 Schema

```ts
export const lootAwards = pgTable("loot_awards", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: uuid("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  auctionId: varchar("auction_id", { length: 128 }).notNull(),
  itemId: integer("item_id").notNull(),
  itemName: varchar("item_name", { length: 256 }),
  itemLevel: integer("item_level"),
  itemIconUrl: text("item_icon_url"),
  winnerName: varchar("winner_name", { length: 64 }).notNull(),
  pricePaid: integer("price_paid").notNull(),
  highestBid: integer("highest_bid").notNull(),
  bidRule: bidRuleEnum("bid_rule").notNull(),          // highest | second_price | fixed
  raidEventId: uuid("raid_event_id").references(() => raidEvents.id, { onDelete: "set null" }),
  bossName: varchar("boss_name", { length: 128 }),
  dkpEntryId: uuid("dkp_entry_id").references(() => dkpEntries.id, { onDelete: "set null" }),
  allBids: jsonb("all_bids").$type<Array<{ player: string; amount: number; at: number }>>(),
  auctioneer: varchar("auctioneer", { length: 64 }).notNull(),
  awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull(),
}, (t) => [
  unique("loot_award_auction").on(t.guildId, t.auctionId),
  index("loot_award_guild_time").on(t.guildId, t.awardedAt.desc()),
]);
```

`allBids` vollständig zu speichern ist bewusst gewählt: Bei jedem Streit über eine Vergabe ist das Gebotsprotokoll die einzige belastbare Antwort. Der Platzbedarf ist vernachlässigbar.

Die Verknüpfung auf `dkpEntryId` macht Loot und Buchung nachvollziehbar zusammenhängend — und deckt Abweichungen auf, falls die Abbuchung einmal fehlschlägt.

### 4.6 Umsetzung je Komponente

**Addon** (Hauptaufwand, ~800–1.000 Zeilen Lua, neues Modul `Modules/Auction.lua`):
* Auktionsfenster für den Officer: Item per Drag-and-Drop oder Shift-Klick aus der Beutetasche, Dauer, Verfahren, Mindestgebot
* Gebotsfenster für Raider: Item-Tooltip, eigener DKP-Stand, Eingabe, Countdown
* Officer-Übersicht: laufende Gebote, manuelles Vorzeitig-Beenden, Abbruch
* Nachrichten `AUCTION:START`, `BID`, `AUCTION:RESULT`, `AUCTION:CANCEL` über den bestehenden Bus in `Core.lua:113`
* **Wichtig:** Der Item-Link enthält `|`-Zeichen. Bei [B5](Code_Review_2026-09.md#b5) im Review steht, warum das im aktuellen Wire-Format die Nachricht zerlegt. Entweder wird nur die `itemID` übertragen (empfohlen — der Client baut den Link über `C_Item.GetItemInfo` selbst) oder das Format bekommt vorher ein Escaping. Ersteres ist robuster und kürzer.

**API** (~150 Zeilen):
* `POST /guilds/:id/loot` — Vergabe entgegennehmen, mit `requireRole("editor")`
* `GET /guilds/:id/loot` — Verlauf mit Filtern
* `GET /guilds/:id/loot/player/:name`
* Guthabenprüfung aus [4.4c](#44-die-vier-fallstricke) in `spend` nachziehen
* Aktivitätsereignis `loot_awarded` emittieren (Feature 1)

**Web** (~250 Zeilen):
* `/dashboard/loot` — wer hat wann was für wieviel bekommen, Item-Icons über `itemIconCache`
* Lootverlauf im Spielerprofil unter `dkp/player/[name]`
* Gebotsprotokoll ausklappbar pro Vergabe

**Discord** (~100 Zeilen):
* Automatischer Post: `🏆 Brynja erhält [Ätherisch verstärkter Brustharnisch] für 150 DKP (Höchstgebot: 180, Zweitpreis)`
* `/loot history [spieler]`
* `/loot item <name>` — wer hat diesen Gegenstand schon bekommen

**Aufwand:** Addon ~3 Tage, Rest ~2 Tage.

---

## 5. Gesamtbild

### Neue Tabellen

| Tabelle | Feature |
|---------|---------|
| `mplus_runs`, `mplus_run_members` | 2 |
| `crafting_orders` | 3 |
| `loot_awards` | 4 |
| Erweiterung `activity_logs` (`guildId`, `dedupeKey`, nullable `characterId`, Enum) | 1 |
| Erweiterung `guild_settings` (`activityChannelId`, `craftingChannelId`, `professionRoleIds`) | 1, 3 |

### Was den Aufwand am stärksten senkt

Drei Dinge existieren bereits und sollten konsequent wiederverwendet werden, statt sie je Feature neu zu bauen:

1. **Das Muster aus `dkpBoard.ts`** — rollendes Embed, ID in `guild_settings`, Scheduler-Lauf, Neuanlage bei gelöschter Nachricht. Passt eins zu eins auf Aktivitätenfeed und Handwerksaufträge.
2. **`itemIconCache` + `resolveIconUrl()`** aus `jobs/equipment.ts` — deckt Icons für Handwerksaufträge und Loot mit ab.
3. **Der Sync-Rückkanal** (`sync.ts:566`) — der Weg vom Web ins Addon existiert bereits; die Auktion braucht ihn für nachträgliche Korrekturen. Vorher sollte allerdings [B7](Code_Review_2026-09.md#b7) behoben sein, sonst gehen Korrekturen bei Verbindungsabbruch verloren.

### Nicht machbar — damit niemand danach sucht

* **Gegenstände automatisch übergeben.** Keine API bewegt Items zwischen Spielern. Der Handel bleibt manuell.
* **Handwerksaufträge im Hintergrund abrufen.** Siehe [3.1](#31-die-entscheidende-einschränkung).
* **M+-Läufe ohne Addon und ohne Raider.IO.** Die Blizzard-Profil-API liefert M+-Ergebnisse, aber keine Gruppenzusammensetzung.
* **Gebote ohne Addon abgeben.** Ein Web- oder Discord-Gebot käme Sekunden zu spät und kennt den Raidkontext nicht.
