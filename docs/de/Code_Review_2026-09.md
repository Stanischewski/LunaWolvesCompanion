# Code-Review — LunaWolvesCompanion + LunaWolves (Stand 2026-09-20)

Geprüft wurden beide Repositories vollständig:

| Repo | Umfang | Basis-Commit |
|------|--------|--------------|
| LunaWolvesCompanion | ~8.300 Zeilen TS/TSX, 723 Zeilen Rust | `4281dec` |
| LunaWolves (Addon) | ~4.400 Zeilen Lua | `809e651` |

**Ausgangslage:** `pnpm build` läuft in allen 5 Paketen fehlerfrei durch, `pnpm test` meldet 20/20 grüne Tests. Die gefundenen Probleme sind also keine Compile-Fehler, sondern Logik-, Berechtigungs- und Skalierungsfehler.

**Verifikationsgrad:** Befunde mit ✅ wurden ausgeführt und reproduziert. Befunde mit 🔍 sind aus dem Code abgeleitet und hoch wahrscheinlich, aber nicht zur Laufzeit gegengeprüft (kein Live-Server, keine WoW-Instanz).

---

## 0. Kurzfassung — die fünf wichtigsten Punkte

1. **Jeder eingeloggte Battle.net-Nutzer ist faktisch Officer.** Sämtliche DKP- und Raid-Schreibendpunkte hängen nur an `app.authenticate` (= gültiges JWT), nicht an `requireRole`. Die Rollenprüfung existiert, wird aber ausschließlich in `settings.ts` verwendet. → [A1](#a1)
2. **`/dkp award` und `/dkp spend` im Discord-Bot sind kaputt** und antworten mit HTTP 500. Reproduziert. → [B1](#b1)
3. **Der Season-Reset hält nicht.** Weder im Web noch im Addon. Beim nächsten Sync kommen die alten Punkte zurück. → [B2](#b2), [B3](#b3)
4. **Bei Bosskills verlieren im Schnitt ~5 % der Raids einzelne Spieler-Awards** durch Entry-ID-Kollisionen — stillschweigend, ohne Fehlermeldung. → [B4](#b4)
5. **Die Datenbank hat null Sekundärindizes.** Jede Roster-, Aktivitäts- und DKP-Abfrage ist ein Sequential Scan. → [C6](#c6)

---

## A. Sicherheit und Berechtigungen

### <a id="a1"></a>A1 — Alle DKP-Schreiboperationen ohne Rollenprüfung 🔍 · **kritisch**

`apps/api/src/routes/dkp.ts:85,150,214,275,315`

```ts
app.post(".../dkp/award",  { onRequest: [app.authenticate] }, ...)
app.post(".../dkp/spend",  { onRequest: [app.authenticate] }, ...)
app.post(".../dkp/adjust", { onRequest: [app.authenticate] }, ...)
app.delete(".../dkp/players/:playerName", { onRequest: [app.authenticate] }, ...)
app.post(".../dkp/reset",  { onRequest: [app.authenticate] }, ...)
```

`app.authenticate` prüft ausschließlich, ob ein JWT gültig ist — also ob sich *irgendjemand* per Battle.net angemeldet hat. `requireRole("admin"|"editor")` aus `lib/permissions.ts` wird in der gesamten API nur an zwei Stellen verwendet (`settings.ts:17,29`).

**Folge:** Jedes Gildenmitglied mit Web-Login kann sich selbst beliebig DKP gutschreiben, anderen Punkte abziehen, Spieler löschen und die Season zurücksetzen.

**Fix:** `requireRole("editor")` für `award`/`spend`/`adjust`, `requireRole("admin")` für `delete`/`reset`. Der Bot-Pfad braucht zusätzlich die Behandlung aus [B1](#b1).

---

### <a id="a2"></a>A2 — Raid-Endpunkte ohne Rollen- und Eigentumsprüfung 🔍 · **hoch**

`apps/api/src/routes/raids.ts:28,56,78,131`

Zwei getrennte Probleme:

* Raids anlegen (`POST /guilds/:guildId/raids`) und bearbeiten (`PATCH /raids/:id`) steht jedem angemeldeten Nutzer offen.
* `POST /raids/:id/signup` nimmt eine beliebige `characterId` entgegen, **ohne zu prüfen, ob dieser Charakter dem anfragenden Spieler gehört**. Jeder kann fremde Charaktere an- und ummelden oder — über die Logik „ein Charakter pro Spieler pro Raid" in `raids.ts:83-98` — fremde Anmeldungen löschen lassen.

**Fix:** Rollenprüfung für Create/Patch; im Signup-Handler `characters.playerId === request.user.sub` erzwingen.

---

### <a id="a3"></a>A3 — Mass Assignment bei Gilden + primäre Gilde ungeschützt 🔍 · **hoch**

`apps/api/src/routes/guilds.ts:15,22`

```ts
app.post("/guilds", { onRequest: [app.authenticate] }, async (request, reply) => {
  const [guild] = await db.insert(guilds).values(request.body).returning();
```

`request.body` geht ungefiltert in den Insert. Ein Body mit `{"name":"x","realm":"y","faction":"horde","isPrimary":true}` legt direkt eine primäre Gilde an. Zusätzlich ist `/guilds/:id/set-primary` nur mit `app.authenticate` geschützt.

Das ist mehr als Kosmetik: `requireRole()` in `lib/permissions.ts:56-58` löst die zuständigen Admin-Rollen **über die primäre Gilde** auf. Wer die primäre Gilde umschaltet, zeigt die Rollenauflösung auf eine Gilde ohne konfigurierte `adminRoleIds` — und sperrt damit alle echten Admins aus dem Settings-Bereich aus.

**Fix:** Explizite Feldauswahl statt `request.body`, plus `requireRole("admin")` auf beiden Endpunkten.

---

### <a id="a4"></a>A4 — Mass Assignment bei Charakteren, DKP-Identitätsfälschung 🔍 · **hoch**

`apps/api/src/routes/characters.ts:39,59`

```ts
.set(request.body)   // PATCH /characters/:id
```

Der TypeScript-Typ schränkt zur Laufzeit nichts ein. Über den Body lassen sich `guildId`, `name` und `realm` überschreiben.

In Kombination mit [A1](#a1) entsteht eine vollständige Kette: `POST /characters` erlaubt jedem Nutzer, einen Charakter mit **beliebigem Namen in beliebiger Gilde** anzulegen. Genau diesen Namen prüft `dkp.ts:88-95` als „Charakter bekannt" ab, bevor DKP vergeben wird. Damit lässt sich die einzige Plausibilitätsprüfung des DKP-Systems aushebeln.

**Fix:** Feldweiße Übernahme; `POST /characters` auf Charaktere beschränken, die über einen Addon-Sync oder die Battle.net-Profil-API belegt sind.

---

### <a id="a5"></a>A5 — Officer-Prüfung im Bot ist fail-open 🔍 · **hoch**

`apps/bot/src/commands/dkp.ts:11-13`

```ts
function isOfficer(interaction) {
  const roleIds = config.officerRoleIds;
  if (roleIds.length === 0) return true;   // ← keine Konfiguration = alle sind Officer
```

`OFFICER_ROLE_IDS` ist in `config.ts:18` eine optionale Umgebungsvariable. Fehlt sie oder ist sie leer, darf jeder Discord-Nutzer `/dkp award` und `/dkp spend` ausführen. Fehlkonfiguration darf nicht in *mehr* Rechte münden.

**Fix:** `if (roleIds.length === 0) return false;` plus einmalige Warnung beim Start.

---

### <a id="a6"></a>A6 — Unauthentifizierte Endpunkte geben Gildendaten preis 🔍 · **mittel**

| Endpunkt | Datei | Preisgegeben |
|----------|-------|--------------|
| `GET /guilds/:guildId/sync/latest` | `sync.ts:664` | **kompletter Roh-Snapshot**: DKP-History, BattleTags, Offiziersnotizen-nahe Daten |
| `GET /guilds/:guildId/activity` | `sync.ts:617` | Aktivitätsprotokoll aller Charaktere |
| `GET /guilds/:guildId/dkp/standings`, `/history`, `/seasons` | `dkp.ts:9,35,63` | vollständiger DKP-Stand |
| `GET /characters/:id` | `characters.ts:11` | Charakter inkl. Equipment |
| `GET /guilds/:id/members` | `guilds.ts:53` | Roster inkl. `bnetTag` |

Alle ohne `onRequest`-Guard. Geschützt wird nur durch die Unkenntnis der Gilden-UUID — das ist keine Zugriffskontrolle. `sync/latest` ist der gravierendste Fall, weil der Roh-Snapshot die BattleTags aus dem Versions-Modul enthält, die Nutzer über das Optionspanel bewusst freigeben oder eben nicht.

**Fix:** Mindestens `app.authenticate`; für `sync/latest` `requireRole("admin")`.

---

### <a id="a7"></a>A7 — JWTs in URLs und damit in den Logs 🔍 · **mittel**

`apps/api/src/routes/auth.ts:81,110` · `apps/web/app/auth/discord-link/route.ts:8`

```ts
return reply.redirect(`${frontendUrl}/auth/callback?token=${jwt}`);
return redirect(`${apiUrl}/auth/discord/link?token=${token}`);
```

Die API läuft mit `Fastify({ logger: true })` (`index.ts:21`), das standardmäßig `req.url` protokolliert. Sieben Tage gültige Tokens landen damit im Klartext in den PM2-Logs auf CT 202, zusätzlich in Browser-History und `Referer`-Headern.

**Fix:** Token per `POST`-Formular oder über einen kurzlebigen Einmal-Code austauschen; alternativ `redact: ['req.url']` in der Logger-Konfiguration und `Referrer-Policy: no-referrer`.

---

### <a id="a8"></a>A8 — WebSocket ohne Authentifizierung 🔍 · **mittel**

`apps/api/src/ws/socket.ts:8-11`

```ts
socket.on("join:guild", (guildId: string) => { void socket.join(`guild:${guildId}`); });
```

Jeder anonyme Client kann jedem Gilden-Raum beitreten und erhält `dkp_update`, `raid_signup` und `member_seen` live mit. Außerdem gibt es keine Obergrenze für die Zahl der Räume pro Socket.

**Fix:** JWT im `auth`-Handshake prüfen, Gildenzugehörigkeit gegen `characters` validieren, Raumzahl begrenzen.

---

### <a id="a9"></a>A9 — Desktop-Login ohne `state`-Nonce, Token im Klartext 🔍 · **mittel**

`apps/desktop/src-tauri/src/lib.rs:239-278`

Der Loopback-Server akzeptiert **die erste beliebige Anfrage** mit einem `token=`-Parameter. Es gibt keinen `state`-Nonce, der die Rückleitung an die gestartete Sitzung bindet. Ein lokaler Prozess, der die Ports durchprobiert, kann dem Agent ein fremdes Token unterschieben.

Zusätzlich landet das JWT unverschlüsselt in `config.json` (`lib.rs:24-31, 58-64`) mit Standard-Dateirechten.

**Fix:** Zufälligen `state`-Wert erzeugen, über `/auth/desktop?port=&state=` durchreichen und beim Rücklauf vergleichen; Token über den OS-Schlüsselbund ablegen (`keyring`-Crate).

---

### <a id="a10"></a>A10 — Battle.net-Access-Token unverschlüsselt in der DB 🔍 · **niedrig-mittel**

`apps/api/src/db/schema.ts:35` — `bnetAccessToken: text(...)`.

Bei einem DB-Leak sind fremde Battle.net-Profile mit `wow.profile`-Scope abrufbar. Verschlüsselung at rest (`pgcrypto` oder anwendungsseitig mit einem Schlüssel aus der Env) wäre angemessen.

---

## B. Funktionsfehler

### <a id="b1"></a>B1 — `/dkp award` und `/dkp spend` im Bot antworten mit HTTP 500 ✅ · **kritisch**

`apps/api/src/index.ts:70-81` in Verbindung mit `apps/api/src/routes/dkp.ts:100,165,229,279,321`

`app.authenticate` kehrt beim Bot-Secret-Pfad früh zurück, **ohne `request.user` zu setzen**:

```ts
app.decorate("authenticate", async function (request, reply) {
  const botSecret = process.env.BOT_SECRET;
  if (botSecret && request.headers["x-bot-secret"] === botSecret) {
    return;                       // request.user bleibt null
  }
  ...
```

Die DKP-Handler greifen anschließend bedingungslos zu:

```ts
const officerName: string = (request.user as { bnetTag: string }).bnetTag;
```

**Reproduktion** (minimales Fastify-Setup mit identischen Dekoratoren):

```
BOT-SECRET  -> 500 {"statusCode":500,"error":"Internal Server Error",
                    "message":"Cannot read properties of null (reading 'bnetTag')"}
KEINE AUTH  -> 401 {"error":"Nicht authentifiziert"}
```

Da `apps/bot/src/api.ts:88-96` jede Anfrage mit `x-bot-secret` signiert, schlägt **jedes** `/dkp award` und `/dkp spend` aus Discord fehl. Der Nutzer sieht „❌ API /guilds/…/dkp/award: 500 — …" (`commands/dkp.ts:130-133`).

Nebenbefund derselben Ursache: `sync.ts:270` liest `request.user.sub` und würde bei Bot-Secret-Auth ebenfalls werfen.

**Fix:** In `authenticate` beim Bot-Pfad eine Kennung setzen, z. B.

```ts
if (botSecret && request.headers["x-bot-secret"] === botSecret) {
  request.user = { sub: BOT_PLAYER_ID, bnetTag: "Discord-Bot" };
  return;
}
```

Sauberer wäre ein eigener Guard, der den Officer-Namen aus dem Request-Body entgegennimmt, damit im DKP-Protokoll steht, *welcher* Discord-Officer gehandelt hat — aktuell ginge diese Information ohnehin verloren.

---

### <a id="b2"></a>B2 — Season-Reset im Web wird vom nächsten Sync rückgängig gemacht 🔍 · **kritisch**

`apps/api/src/routes/dkp.ts:315-352` und `apps/api/src/routes/sync.ts:502-530`

Der Reset archiviert die Standings und setzt sie auf 0 — **die Einträge in `dkp_entries` bleiben unangetastet.** Der nächste Addon-Sync berechnet die Standings für jeden betroffenen Spieler aber vollständig neu:

```ts
const [sums] = await tx.select({
    current:  sql`COALESCE(SUM(${dkpEntries.delta}), 0)::int`,
    lifetime: sql`COALESCE(SUM(CASE WHEN ${dkpEntries.delta} > 0 THEN ... END), 0)::int`,
  }).from(dkpEntries).where(whereClause);
```

Gefiltert wird nur über Tombstones, nicht über eine Season-Grenze. Sobald ein Spieler nach dem Reset einen einzigen neuen Eintrag bekommt, steht sein kompletter Vor-Reset-Stand wieder da — und zwar nur für diesen Spieler, was zu einer halb zurückgesetzten, inkonsistenten Tabelle führt.

**Fix:** `dkp_seasons` um `startedAt`/`endedAt` erweitern, `dkp_entries` um `seasonId`, und die Summenbildung auf die laufende Season begrenzen. Das löst gleichzeitig [B8](#b8).

---

### <a id="b3"></a>B3 — Season-Reset im Addon wird von offline gewesenen Officers rückgängig gemacht 🔍 · **kritisch**

`LunaWolves/Modules/DKP.lua:1631-1657` und `398-432`

`_PerformReset` leert History und Punkte und setzt `lastSyncTimestamp = 0`. Der RESET-Broadcast erreicht aber nur Officers, die **in diesem Moment online** sind. Wer offline war, behält seine vollständige History.

Danach fordert jeder zurückgesetzte Client wegen `lastSyncTimestamp = 0` beim nächsten Login einen Vollabgleich an — und `HandleSyncRequest` beantwortet den mit *allen* Einträgen:

```lua
for _, entry in ipairs(LunaWolvesDB.DKP.history) do
    if entry.timestamp > sinceTs then   -- sinceTs == 0 → alles
```

Der Officer, der den Reset verpasst hat, spielt damit die gesamte alte Season wieder in die Gilde zurück. Es gibt keinen Epochen-Zähler, der alte Einträge als ungültig markiert.

**Fix:** `LunaWolvesDB.DKP.seasonEpoch` (Zeitstempel des letzten Resets) einführen, bei jedem Sync mitschicken und Einträge mit `timestamp < seasonEpoch` beim Empfang verwerfen. Der Epochenwert gehört in denselben Sync-Pfad wie die Tombstones.

---

### <a id="b4"></a>B4 — Entry-ID-Kollisionen lassen Bosskill-Awards verschwinden 🔍 · **hoch**

`LunaWolves/Modules/DKP.lua:104-106` und `238-254`

```lua
local function GenerateEntryId(officer)
    return officer .. "-" .. time() .. "-" .. math.random(1000, 9999)
end
```

`OnEncounterEnd` ruft `Award()` in einer engen Schleife für den gesamten Raid auf. Alle Aufrufe fallen in dieselbe Sekunde, beim selben Officer — die ID-Eindeutigkeit hängt damit allein an 9.000 Zufallswerten.

Für 30 Raidmitglieder: P(mindestens eine Kollision) ≈ 1 − exp(−30·29 / (2·9000)) ≈ **4,7 % pro Bosskill**.

Bei einer Kollision erkennt die Duplikatprüfung in `Award()` (`DKP.lua:155-159`) den zweiten Eintrag als bereits vorhanden und gibt `false` zurück. Der Spieler bekommt keine Punkte, der Eintrag landet nicht im Batch-Broadcast — **ohne jede Meldung**. Bei 8 Bossen pro Abend liegt die Wahrscheinlichkeit, dass mindestens ein Spieler leer ausgeht, bei rund 32 %.

**Fix:** Monoton steigenden Zähler statt Zufall:

```lua
local seq = 0
local function GenerateEntryId(officer)
    seq = seq + 1
    return officer .. "-" .. time() .. "-" .. seq
end
```

Der Zähler darf pro Sitzung bei 0 starten, solange `time()` Teil der ID bleibt.

---

### <a id="b5"></a>B5 — Trennzeichen im Grund zerstören Sync-Nachrichten 🔍 · **hoch**

`LunaWolves/Modules/DKP.lua:357-371, 374-395, 434-457`

Das Wire-Format ist `id;player;delta;reason;type;officer;timestamp`, Batches werden mit `|` getrennt. Der Grund ist frei eingegebener Text (`/lw dkp add Name Anzahl Grund`, Eingabedialog in `DKP.lua:1481`).

Enthält er ein `;`, verschieben sich alle Folgefelder:

```lua
local id, player, delta, reason, entryType, officer, ts = strsplit(";", payload)
```

`reason = "Loot;Trinket"` → `entryType` wird `"Trinket"`, `officer` bekommt den echten Typ, `ts` den Officersnamen. `tonumber(ts)` liefert `nil`, der Fallback setzt `time()` — der Eintrag bekommt also beim Empfänger einen anderen Zeitstempel als beim Sender, mit direkter Wirkung auf `lastSyncTimestamp` und die Tombstone-Prüfung in `IsDeletedAfter`. Ein `|` im Grund zerlegt einen Eintrag sogar in zwei unbrauchbare Teile.

**Fix:** Beim Senden escapen (`reason:gsub("[;|]", " ")` als Minimallösung) oder auf ein Format mit Längenpräfix wechseln. Zusätzlich sollte der Eingabedialog die Zeichen gar nicht erst annehmen.

---

### <a id="b6"></a>B6 — Send-Queue-Drossel greift nicht 🔍 · **hoch**

`LunaWolves/Core.lua:141-155`

```lua
function LunaWolves:QueueSend(msg, channel, target)
    table.insert(SEND_QUEUE, {...})
    if not SEND_TIMER then self:ProcessSendQueue() end
end

function LunaWolves:ProcessSendQueue()
    ...
    SEND_TIMER = C_Timer.After(0.1, function() LunaWolves:ProcessSendQueue() end)
end
```

`C_Timer.After` liefert **keinen Handle zurück** (nur `C_Timer.NewTimer` tut das). `SEND_TIMER` bleibt deshalb dauerhaft `nil`, die Wächterbedingung `if not SEND_TIMER` ist immer wahr — und **jeder** `QueueSend`-Aufruf startet eine zusätzliche, parallel laufende Abarbeitungsschleife.

Beim Bosskill-Batch oder bei einer gechunkten SYNCRESP entstehen so dutzende parallele Schleifen, die gemeinsam weit über die beabsichtigten 10 Nachrichten/Sekunde hinausschießen. Das ist genau das Verhalten, das Blizzards Addon-Nachrichten-Drossel mit verworfenen Nachrichten bis hin zur Trennung beantwortet — und damit ein plausibler Grund für „verpasste" Sync-Nachrichten, gegen die das Sicherheitsnetz in `DKP.lua:273-281` nachträglich ansyncen muss.

**Fix:** `SEND_TIMER = C_Timer.NewTimer(0.1, ...)` oder ein einfaches boolesches `SEND_RUNNING`-Flag, das in `ProcessSendQueue` bei leerer Queue zurückgesetzt wird.

---

### <a id="b7"></a>B7 — Rückkanal verliert Einträge bei Verbindungsabbruch 🔍 · **mittel**

`apps/api/src/routes/sync.ts:566-585` und `641-660`

```ts
const pendingWebEntries = await db.select()... ;
if (pendingWebEntries.length > 0) {
  await db.update(dkpEntries).set({ addonSyncedAt: new Date() })... ;   // als geliefert markiert
}
return reply.status(201).send({ ..., pendingWebEntries });               // ...bevor sie ankommen
```

Die Einträge gelten als ausgeliefert, sobald die Antwort *abgeschickt* wird. Bricht die Verbindung ab oder stürzt der Desktop-Agent beim Verarbeiten ab, sind die im Web vergebenen DKP-Punkte für das Addon dauerhaft verloren — `addonSyncedAt` ist gesetzt, sie tauchen nie wieder auf.

**Fix:** Zweistufig bestätigen. Die Antwort liefert die Einträge samt IDs, ein separates `POST /sync/ack` markiert sie nach erfolgreicher Verarbeitung. Bis dahin werden sie erneut ausgeliefert — das Addon erkennt Duplikate ohnehin über die Entry-ID.

---

### <a id="b8"></a>B8 — Tombstone-Verfall wird serverseitig nie ausgewertet 🔍 · **mittel**

`apps/api/src/routes/sync.ts:391-397`

```ts
const activeTombstones = await tx.query.dkpTombstones.findMany({
  where: eq(dkpTombstones.guildId, guild.id),        // expiresAt wird ignoriert
});
```

Die Spalte `expiresAt` wird geschrieben (`dkp.ts:281`, `sync.ts:377`), aber nirgends gelesen. Das Addon prunt nach 90 Tagen (`DKP.lua:111-120`), der Server nicht. Ein vor Jahren gelöschter Spieler, der zurückkehrt, wird serverseitig für immer gefiltert — seine neuen Einträge werden verworfen, während das Addon sie längst wieder akzeptiert. Die beiden Systeme driften damit dauerhaft auseinander.

**Fix:** `and(eq(guildId), gt(dkpTombstones.expiresAt, new Date()))` plus ein Aufräum-Job.

---

### <a id="b9"></a>B9 — Gildenaustritte werden nie erkannt 🔍 · **mittel**

`apps/api/src/routes/sync.ts:325-380`

Der Sync legt neue Charaktere an und aktualisiert vorhandene. Charaktere, die **nicht mehr** im hochgeladenen Roster stehen, bleiben unverändert in der Datenbank. Ausgetretene Mitglieder erscheinen dauerhaft im Web-Roster, im DKP-Board und in der `/guild members`-Ausgabe des Bots.

`guilds.memberCount` wird dagegen auf `roster.members.length` gesetzt — Zähler und Tabelle widersprechen sich also dauerhaft.

**Fix:** `characters.leftGuildAt` setzen, wenn ein Charakter in einem Snapshot fehlt (nicht hart löschen — die DKP-History soll erhalten bleiben), und die Roster-Ansichten darauf filtern.

---

### <a id="b10"></a>B10 — Roster-Scan erfasst möglicherweise nur Online-Mitglieder 🔍 · **mittel, zu verifizieren**

`LunaWolves/Modules/Roster.lua:88-97`

`GetNumGuildMembers()` und `GetGuildRosterInfo(i)` liefern je nach „Offline anzeigen"-Einstellung der Gildenoberfläche unterschiedliche Datensätze. Das Addon setzt diese Einstellung nicht aktiv. Steht sie beim Nutzer auf „aus", liefert `GetGuildRosterInfo(i)` für die Offline-Indizes `nil`, die Schleife überspringt sie per `if name and classFile then` — und der Upload enthält nur die gerade eingeloggten Mitglieder.

Das passt zum Symptom hinter dem Fallback in `sync.ts:283-290` und würde erklären, warum `memberCount` schwankt.

**Empfehlung:** Vor dem Scan `C_GuildInfo.SetGuildRosterShowOffline(true)` setzen (bzw. den Wert des Nutzers sichern und danach wiederherstellen) und im Log ausgeben, wie viele der `GetNumGuildMembers()`-Einträge tatsächlich gelesen wurden. **Im Spiel gegenprüfen**, bevor umgebaut wird — das Verhalten der API hat sich zwischen Erweiterungen mehrfach geändert.

---

### <a id="b11"></a>B11 — Gruppeneinladungen lassen sich fälschen 🔍 · **niedrig-mittel**

`LunaWolves/Modules/RaidInvite.lua:293-310`

```lua
function RAID:HandleRequest(payload, sender)
    local groupId, player, class, spec = strsplit(";", payload)
    ...
    C_PartyInfo.InviteUnit(player)      -- player kommt aus dem Payload, nicht vom Sender
```

Der Einladungsempfänger wird aus der Nachricht gelesen statt aus dem verifizierten `sender`. Ein manipulierter Client kann den Gruppenleiter dazu bringen, beliebige Spieler einzuladen — bei aktiviertem `autoAccept` vollautomatisch.

**Fix:** `player` ignorieren und `sender` bzw. `senderFull` verwenden. Klasse und Spec dürfen aus dem Payload bleiben, sie sind unkritisch.

---

### <a id="b12"></a>B12 — Gildenzuordnung nur über den Namen kann danebengreifen 🔍 · **niedrig**

`apps/api/src/routes/sync.ts:283-290`

Der Fallback sucht bei fehlendem Treffer nur noch über `guilds.name`. Auf verbundenen Realms ist das gewollt, bei zwei gleichnamigen Gilden auf verschiedenen Realms landet der Upload aber in der falschen Gilde — inklusive DKP-Einträgen.

**Fix:** Den Fallback an die Fraktion und die Schnittmenge der Charakternamen koppeln, oder die Realm-Gruppe explizit in `guilds` hinterlegen.

---

### <a id="b13"></a>B13 — `__proto__` in SavedVariables verschluckt Einträge ✅ · **niedrig**

`packages/lua-parser/src/parser.ts` → `buildTable()`

```ts
const object: { [key: string]: LuaValue } = {};
for (const [key, value] of map) object[String(key)] = value;
```

Reproduziert mit `LunaWolvesDB = { ["__proto__"] = { ["pwned"] = true } }`:

```
eigene Keys: []
db.pwned: true
Prototyp == Object.prototype? false
global verseucht? undefined
```

Keine globale Prototype Pollution — aber der Schlüssel verschwindet aus `Object.keys()`, und Felder lassen sich über die Prototypkette einschmuggeln, wo Prüfungen nur eigene Eigenschaften betrachten. Bei einem Parser, der fremde Dateien liest, ist das unnötiges Risiko.

**Fix:** `const object = Object.create(null)` oder `__proto__` explizit überspringen. Ein Testfall dafür passt gut in `lua-parser.test.ts`.

---

### <a id="b14"></a>B14 — Abgelegte Ausrüstung bleibt stehen 🔍 · **niedrig**

`apps/api/src/jobs/equipment.ts:180-230`

Der Sync macht ausschließlich Upserts. Legt ein Spieler einen Gegenstand ab (z. B. das zweite Schmuckstück), bleibt der alte Datensatz mit altem `syncedAt` in `character_equipment` und wird im Dashboard weiter angezeigt.

**Fix:** Nach dem Durchlauf die Slots löschen, die nicht in `equipped_items` vorkamen.

---

### <a id="b15"></a>B15 — Kein Refresh-Token: Equipment-Sync stirbt nach ~24 Stunden 🔍 · **mittel**

`apps/api/src/index.ts:44` (`scope: ["openid", "wow.profile"]`) und `apps/api/src/jobs/equipment.ts:100-107`

Ohne `offline_access` im Scope gibt Battle.net keinen Refresh-Token aus. `bnetTokenExpiry` liegt typischerweise 24 Stunden in der Zukunft, danach filtert der Job den Spieler heraus:

```ts
.where(and(isNotNull(players.bnetAccessToken), gt(players.bnetTokenExpiry, now)))
```

Es gibt keinen Hinweis im Dashboard, dass das Equipment veraltet ist. Praktisch heißt das: Equipment-Daten existieren nur für Spieler, die sich in den letzten 24 Stunden eingeloggt haben.

**Fix:** `offline_access` anfordern, Refresh-Token speichern und vor dem Job erneuern. Falls Battle.net den Scope nicht gewährt, wenigstens das „Stand von"-Datum im Dashboard anzeigen und Spieler mit abgelaufenem Token zur Neuanmeldung auffordern.

---

## C. Performance und Optimierung

### <a id="c1"></a>C1 — N+1-Abfragen im Sync-Pfad · **hoch**

`apps/api/src/routes/sync.ts:325-380, 466-499, 502-530`

Drei Schleifen in derselben Transaktion:

| Schleife | Abfragen pro Durchlauf | bei 500 Mitgliedern |
|----------|------------------------|---------------------|
| Charaktere (`:325`) | 1 SELECT + 1 INSERT/UPDATE + ggf. 1 activity-INSERT | bis zu 1.500 |
| Auto-Linking (`:466`) | 2 SELECT + 1 UPDATE | bis zu 1.500 |
| Standings (`:502`) | 1 SELECT + 1 UPSERT je betroffenem Spieler | variabel |

Die DKP-Einträge wurden bereits auf Bulk-Prefetch plus Batch-Insert optimiert (`sync.ts:399-430`) — dasselbe Muster fehlt bei den übrigen drei. Die Transaktion hält dabei durchgehend Schreibsperren.

**Fix:** Charaktere der Gilde einmal vorladen, im Speicher gegen den Roster diffen, dann ein `insert().onConflictDoUpdate()` mit allen Zeilen. Die Standings lassen sich vollständig in einer einzigen `INSERT ... SELECT ... GROUP BY player_name ... ON CONFLICT DO UPDATE`-Anweisung erledigen.

---

### <a id="c2"></a>C2 — `Award()` ist beim Sync quadratisch · **hoch**

`LunaWolves/Modules/DKP.lua:155-159`

```lua
for _, entry in ipairs(LunaWolvesDB.DKP.history) do
    if entry.id == entryId then return false end
end
```

Lineare Suche pro Einfügung. Ein Vollabgleich mit n Einträgen kostet damit n²/2 Vergleiche — bei 3.000 Einträgen rund 4,5 Millionen Tabellenzugriffe in einem einzigen Frame, also ein spürbarer Freeze mitten im Raid.

**Fix:** `DKP._idIndex[entryId] = true` beim Einfügen mitführen und beim Login einmalig aus der History aufbauen. Dieselbe Behandlung verdient `IsDeletedAfter` (`DKP.lua:124-132`).

---

### <a id="c3"></a>C3 — SYNCRESP-Verstärkung · **mittel-hoch**

`LunaWolves/Modules/DKP.lua:398-432`

Auf ein `SYNCREQ` antwortet **jeder** Officer, und zwar mit *allen* Einträgen neuer als `sinceTs` in einer einzigen Nachricht. Beim Erstlogin (`sinceTs = 0`) und 3.000 Einträgen à ~70 Zeichen sind das ~210 KB, die das Chunking in ~900 Addon-Nachrichten zerlegt — pro antwortendem Officer. Bei fünf Officers im Raid also rund 4.500 Nachrichten für einen einzigen neuen Spieler.

**Fix:** Nur ein Officer antwortet (die deterministische Wahl aus `ShouldAutoAward` in `DKP.lua:284-304` existiert bereits und lässt sich wiederverwenden), und die Antwort wird auf z. B. 200 Einträge pro Nachricht begrenzt, mit Fortsetzungsanforderung durch den Empfänger.

---

### <a id="c4"></a>C4 — Raider.IO-Job ohne Überlappungsschutz · **mittel**

`apps/api/src/jobs/raiderio.ts:36-54` und `apps/api/src/index.ts:95-99`

* `setInterval` startet alle 30 Minuten neu, unabhängig davon, ob der vorige Lauf fertig ist. Bei 500 Charakteren × 600 ms = 5 Minuten geht das noch auf; ab ~3.000 Charakteren überlappen sich die Läufe dauerhaft.
* Alle Charaktere werden jedes Mal abgefragt, auch inaktive und solche, die bei Raider.IO gar nicht existieren.
* `region` ist auf `"eu"` festgenagelt (`fetchScore(name, realm, region = "eu")`), obwohl `BNET_REGION` konfigurierbar ist.
* Fehler werden stumm zu `null` (`raiderio.ts:31-33`) — dauerhaft fehlschlagende Charaktere fallen nie auf.

**Fix:** Laufschutz per Flag, Abfrage auf Charaktere mit Aktivität in den letzten 30 Tagen begrenzen, Region aus der Env, Fehlerzähler ins Log. Gleiches gilt für `syncEquipment`.

---

### <a id="c5"></a>C5 — Unbegrenzte In-Memory-Caches, ungenutztes Redis · **mittel**

| Cache | Datei | Eviction |
|-------|-------|----------|
| `roleCache` | `lib/permissions.ts:11` | keine (nur TTL-Prüfung beim Lesen) |
| `syncCooldowns` | `routes/sync.ts:31` | keine |
| `gemStatCache` | `jobs/equipment.ts:8` | keine |
| `CHUNK_BUFFERS` | `Core.lua:19` | 30-Sekunden-Job (vorhanden) |

Die Maps wachsen monoton. Wichtiger noch: sie sind prozesslokal. Sobald die API in PM2 auf `instances > 1` gestellt wird, greifen Sync-Cooldown und Rollen-Cache pro Worker unterschiedlich.

Passend dazu: **CT 201 (`lw-cache`, Redis 7) ist laut `deploy/lxc/README.md:13` bereitgestellt, aber kein einziges Paket hat eine Redis- oder BullMQ-Abhängigkeit.** Der Container läuft ohne Aufgabe. Er ist der naheliegende Platz für diese drei Caches — und für die Job-Queue, die der SimC-Plan bereits voraussetzt.

---

### <a id="c6"></a>C6 — Keine einzige Sekundär-Index-Definition ✅ · **hoch**

`apps/api/src/db/schema.ts` enthält 0 `index()`-Aufrufe, die 16 Migrationen in `apps/api/drizzle/` enthalten 0 `CREATE INDEX`. Indiziert sind damit nur Primärschlüssel und die vier `unique()`-Constraints. Fremdschlüssel legt PostgreSQL **nicht** automatisch an.

Fehlend auf heißen Pfaden:

| Tabelle | Spalten | Verwendet von |
|---------|---------|---------------|
| `characters` | `(guild_id, name, realm)` | `sync.ts:333` — einmal **pro Mitglied pro Sync** |
| `characters` | `(player_id)` | `raids.ts:85`, `bot.ts:22`, `equipment.ts:102` |
| `activity_logs` | `(character_id, recorded_at DESC)` | `sync.ts:617`, `guilds.ts:117` |
| `dkp_entries` | `(guild_id, player_name, occurred_at)` | `sync.ts:516`, `dkp.ts:44` |
| `dkp_entries` | `(guild_id, source, addon_synced_at)` | `sync.ts:568` |
| `raid_signups` | `(character_id)` | `raids.ts:93`, `bot.ts:31` |
| `addon_snapshots` | `(guild_id, uploaded_at DESC)` | `sync.ts:666` |

Bei aktuell kleinen Tabellen fällt das nicht auf; `activity_logs` wächst allerdings mit jedem Sync und jedem Mitglied unbegrenzt.

**Fix:** Indizes in `schema.ts` ergänzen, Migration generieren. Für `activity_logs` zusätzlich eine Aufbewahrungsfrist festlegen (siehe [Feature-Plan, Abschnitt 2](Feature_Roadmap_Integrationsplan.md)).

---

### C7 — Weitere Optimierungen · **niedrig**

* **`resolveGuild()`** (`apps/web/lib/guild.ts`) macht bei jedem Dashboard-Render 1–2 API-Aufrufe ohne Cache. `unstable_cache` mit kurzer TTL würde reichen.
* **Kein Zod/TypeBox-Schema** an den Fastify-Routen. Fastify bringt Schema-Validierung mit; sie würde [A3](#a3) und [A4](#a4) strukturell erschlagen und nebenbei die JSON-Serialisierung beschleunigen.
* **Ungültige UUIDs werfen 500 statt 400.** `guilds.ts` hat mit `UUID_RE` bereits eine Prüfung — `dkp.ts`, `sync.ts`, `raids.ts` und `characters.ts` haben sie nicht.
* **`middleware.ts`** prüft nur die *Existenz* des Cookies. Nach Ablauf der 7 Tage sieht der Nutzer statt einer Anmeldeaufforderung eine Fehlerseite, weil jeder `apiFetch` wirft.
* **Nur `apps/desktop` hat GitHub Actions.** Es gibt keine CI für Lint, Build oder Tests von API/Bot/Web.
* **Testabdeckung:** 20 Tests, alle im `lua-parser`. API, Bot und Web haben keine. Für den DKP-Kern (Standings-Berechnung, Tombstone-Filter, Season-Grenze) wären Integrationstests gegen eine Wegwerf-Postgres-Instanz der wirkungsvollste nächste Schritt.
* **`LunaWolves`-Version steht doppelt** — in `LunaWolves.toc` und hart codiert in `Core.lua:697` (`"v1.2.2 geladen."`). `Versions.lua:53-59` liest sie bereits korrekt über `C_AddOns.GetAddOnMetadata`; Core sollte dasselbe tun.
* **Tote Variable** `isDragging` in `Core.lua:461,471` — wird gesetzt, nie gelesen.

---

## D. Empfohlene Reihenfolge

| Priorität | Punkte | Aufwand |
|-----------|--------|---------|
| **Sofort** | [A1](#a1), [A5](#a5), [B1](#b1) — Rechte scharf schalten, Bot reparieren | klein, klar abgegrenzt |
| **Kurzfristig** | [A2](#a2)–[A4](#a4), [A6](#a6), [B4](#b4), [B5](#b5), [B6](#b6), [C6](#c6) | jeweils klein, hoher Ertrag |
| **Mittelfristig** | [B2](#b2)+[B3](#b3) (Season-Modell), [B7](#b7)–[B9](#b9), [C1](#c1)–[C3](#c3) | Schema- bzw. Protokolländerung |
| **Strukturell** | A7–A10, C5, C7, Testabdeckung, CI | begleitend |

[B2](#b2) und [B3](#b3) gehören zusammen angefasst: Server und Addon brauchen dasselbe Season-Konzept, sonst bleibt der Reset auf einer der beiden Seiten wirkungslos.
