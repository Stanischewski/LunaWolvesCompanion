"use client";
import { useState, useTransition } from "react";
import { createRaidAction, editRaidAction, signupRaidAction } from "./actions";

interface SignupCharacter {
  id: string;
  name: string;
  class: string;
  itemLevel: number;
}

interface Signup {
  raidEventId: string;
  characterId: string;
  role: "tank" | "heal" | "dps";
  status: "yes" | "maybe" | "no";
  character: SignupCharacter;
}

interface RaidEvent {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  raidType: string | null;
  minIlvl: number | null;
  signups: Signup[];
}

interface MyCharacter {
  id: string;
  name: string;
  class: string;
}

const roleLabel: Record<string, string> = { tank: "Tank", heal: "Heal", dps: "DPS" };
const statusLabel: Record<string, string> = { yes: "Zusage", maybe: "Vielleicht", no: "Absage" };

const statusColor: Record<string, string> = {
  yes: "text-emerald-400",
  maybe: "text-yellow-400",
  no: "text-zinc-500",
};

const classColors: Record<string, string> = {
  warrior: "text-amber-500",
  paladin: "text-pink-400",
  hunter: "text-green-400",
  rogue: "text-yellow-400",
  priest: "text-zinc-100",
  shaman: "text-blue-400",
  mage: "text-cyan-400",
  warlock: "text-purple-400",
  monk: "text-emerald-400",
  druid: "text-orange-400",
  demon_hunter: "text-violet-400",
  death_knight: "text-red-500",
  evoker: "text-teal-400",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SignupSummary({ signups }: { signups: Signup[] }) {
  const confirmed = signups.filter((s) => s.status === "yes");
  const maybe = signups.filter((s) => s.status === "maybe");

  const counts = {
    tank: confirmed.filter((s) => s.role === "tank").length,
    heal: confirmed.filter((s) => s.role === "heal").length,
    dps: confirmed.filter((s) => s.role === "dps").length,
  };

  const ilvlValues = confirmed
    .map((s) => s.character.itemLevel)
    .filter((v) => v > 0);
  const avgIlvl =
    ilvlValues.length > 0
      ? Math.round(ilvlValues.reduce((a, b) => a + b, 0) / ilvlValues.length)
      : null;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-4 text-sm flex-wrap">
        <span className="text-zinc-500 text-xs">Zusagen:</span>
        <span className="text-zinc-300">
          <span className="text-amber-400 font-medium">{counts.tank}</span>
          <span className="text-zinc-600 mx-1">Tank</span>
          <span className="text-emerald-400 font-medium">{counts.heal}</span>
          <span className="text-zinc-600 mx-1">Heal</span>
          <span className="text-red-400 font-medium">{counts.dps}</span>
          <span className="text-zinc-600 mx-1">DPS</span>
        </span>
        {avgIlvl !== null && (
          <span className="text-zinc-400 text-xs">
            Ø ilvl <span className="text-zinc-200 font-medium">{avgIlvl}</span>
          </span>
        )}
        {maybe.length > 0 && (
          <span className="text-yellow-400 text-xs">{maybe.length} Vielleicht</span>
        )}
      </div>

      {confirmed.length > 0 && (
        <div className="grid grid-cols-3 gap-1">
          {(["tank", "heal", "dps"] as const).map((role) => {
            const group = confirmed.filter((s) => s.role === role);
            if (group.length === 0) return null;
            return (
              <div key={role} className="space-y-0.5">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">
                  {roleLabel[role]}
                </p>
                {group.map((s) => (
                  <p
                    key={s.characterId}
                    className={`text-xs font-medium ${classColors[s.character.class] ?? "text-zinc-200"}`}
                  >
                    {s.character.name}
                    {s.character.itemLevel > 0 && (
                      <span className="text-zinc-500 font-normal ml-1">
                        {s.character.itemLevel}
                      </span>
                    )}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {maybe.length > 0 && (
        <div className="border-t border-zinc-800 pt-2">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-0.5">Vielleicht</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {maybe.map((s) => (
              <span
                key={s.characterId}
                className={`text-xs ${classColors[s.character.class] ?? "text-zinc-400"}`}
              >
                {s.character.name}
                {s.character.itemLevel > 0 && (
                  <span className="text-zinc-600 ml-1">{s.character.itemLevel}</span>
                )}
                <span className="text-zinc-600 ml-1">({roleLabel[s.role]})</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function CreateRaidModal({ onClose }: { onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await createRaidAction(formData);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fehler beim Erstellen");
      }
    });
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-bold mb-4">Raid erstellen</h2>
      <form action={submit} className="space-y-4">
        <div>
          <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-1">
            Titel *
          </label>
          <input
            name="title"
            required
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-1">
            Datum & Uhrzeit *
          </label>
          <input
            name="scheduledAt"
            type="datetime-local"
            required
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-1">
            Beschreibung
          </label>
          <textarea
            name="description"
            rows={3}
            placeholder="Infos zum Raid, Anforderungen, Hinweise…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-1">
              Raid-Typ
            </label>
            <input
              name="raidType"
              placeholder="Normal, Heroic…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-1">
              Min. ilvl
            </label>
            <input
              name="minIlvl"
              type="number"
              min={1}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={pending}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium transition-colors"
          >
            {pending ? "Erstelle…" : "Erstellen"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Abbrechen
          </button>
        </div>
      </form>
    </Modal>
  );
}

function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EditRaidModal({ raid, onClose }: { raid: RaidEvent; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await editRaidAction(raid.id, formData);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fehler beim Speichern");
      }
    });
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-bold mb-4">Raid bearbeiten</h2>
      <form action={submit} className="space-y-4">
        <div>
          <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-1">
            Titel *
          </label>
          <input
            name="title"
            required
            defaultValue={raid.title}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-1">
            Datum & Uhrzeit *
          </label>
          <input
            name="scheduledAt"
            type="datetime-local"
            required
            defaultValue={toDatetimeLocal(raid.scheduledAt)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-1">
            Beschreibung
          </label>
          <textarea
            name="description"
            rows={3}
            defaultValue={raid.description ?? ""}
            placeholder="Infos zum Raid, Anforderungen, Hinweise…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-1">
              Raid-Typ
            </label>
            <input
              name="raidType"
              placeholder="Normal, Heroic…"
              defaultValue={raid.raidType ?? ""}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 uppercase tracking-wider mb-1">
              Min. ilvl
            </label>
            <input
              name="minIlvl"
              type="number"
              min={1}
              defaultValue={raid.minIlvl ?? ""}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={pending}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium transition-colors"
          >
            {pending ? "Speichere…" : "Speichern"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Abbrechen
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SignupPanel({
  raid,
  myCharacters,
  onClose,
}: {
  raid: RaidEvent;
  myCharacters: MyCharacter[];
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await signupRaidAction(raid.id, formData);
        setSuccess(true);
        setTimeout(onClose, 1200);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fehler beim Anmelden");
      }
    });
  }

  if (myCharacters.length === 0) {
    return (
      <div className="mt-3 p-3 bg-zinc-800 rounded-lg flex items-center justify-between">
        <p className="text-sm text-zinc-400">Bitte einloggen, um dich anzumelden.</p>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs ml-3">
          ✕
        </button>
      </div>
    );
  }

  if (success) {
    return (
      <div className="mt-3 p-3 bg-emerald-900/30 border border-emerald-800 rounded-lg text-sm text-emerald-400">
        Anmeldung gespeichert!
      </div>
    );
  }

  return (
    <div className="mt-3 p-4 bg-zinc-800 rounded-lg border border-zinc-700">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-zinc-300">Für Raid anmelden</p>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">
          ✕
        </button>
      </div>
      <form action={submit} className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-32">
          <label className="block text-xs text-zinc-500 mb-1">Charakter</label>
          <select
            name="characterId"
            required
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
          >
            {myCharacters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Rolle</label>
          <select
            name="role"
            required
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
          >
            <option value="dps">DPS</option>
            <option value="heal">Heal</option>
            <option value="tank">Tank</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Status</label>
          <select
            name="status"
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
          >
            <option value="yes">Zusage</option>
            <option value="maybe">Vielleicht</option>
            <option value="no">Absage</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-3 py-1.5 text-sm font-medium transition-colors"
        >
          {pending ? "…" : "Anmelden"}
        </button>
      </form>
      {error && <p className="mt-2 text-red-400 text-xs">{error}</p>}
    </div>
  );
}

function RaidRow({
  raid,
  myCharacters,
  isPast = false,
}: {
  raid: RaidEvent;
  myCharacters: MyCharacter[];
  isPast?: boolean;
}) {
  const [showSignup, setShowSignup] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const confirmedCount = raid.signups.filter((s) => s.status === "yes").length;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
      {showEdit && <EditRaidModal raid={raid} onClose={() => setShowEdit(false)} />}
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0 pr-4">
          <p className="font-semibold">{raid.title}</p>
          <p className="text-zinc-400 text-sm">{formatDate(raid.scheduledAt)}</p>
          {raid.description && (
            <p className="text-zinc-500 text-sm mt-1 leading-snug">{raid.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right text-sm text-zinc-500 space-y-0.5 mr-2">
            {raid.raidType && <p>{raid.raidType}</p>}
            {raid.minIlvl && <p>min {raid.minIlvl} ilvl</p>}
            {confirmedCount > 0 && (
              <p className="text-emerald-400">{confirmedCount} angemeldet</p>
            )}
          </div>
          <button
            onClick={() => setShowEdit(true)}
            title="Raid bearbeiten"
            className="text-zinc-500 hover:text-zinc-200 px-2 py-1.5 rounded transition-colors text-sm"
          >
            ✎
          </button>
          {!isPast && (
            <button
              onClick={() => setShowSignup((v) => !v)}
              className={`text-sm px-3 py-1.5 rounded font-medium transition-colors ${
                showSignup
                  ? "bg-zinc-700 text-zinc-300"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }`}
            >
              Anmelden
            </button>
          )}
        </div>
      </div>

      {raid.signups.length > 0 && (
        <div className="border-t border-zinc-800 mt-3 pt-3">
          <SignupSummary signups={raid.signups} />
        </div>
      )}

      {showSignup && (
        <SignupPanel
          raid={raid}
          myCharacters={myCharacters}
          onClose={() => setShowSignup(false)}
        />
      )}
    </div>
  );
}

export function RaidsClient({
  guild,
  raids,
  myCharacters,
}: {
  guild: { id: string; name: string; realm: string };
  raids: RaidEvent[];
  myCharacters: MyCharacter[];
}) {
  const [showCreate, setShowCreate] = useState(false);
  const now = new Date();
  const upcoming = raids.filter((r) => new Date(r.scheduledAt) >= now);
  const past = raids.filter((r) => new Date(r.scheduledAt) < now);

  return (
    <div>
      {showCreate && <CreateRaidModal onClose={() => setShowCreate(false)} />}

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold">Raids</h1>
          <span className="text-zinc-500 text-sm">
            {guild.name} – {guild.realm}
          </span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
        >
          + Raid erstellen
        </button>
      </div>

      {raids.length === 0 ? (
        <p className="text-zinc-500">Keine Raid-Events geplant.</p>
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                Kommende Raids ({upcoming.length})
              </h2>
              <div className="space-y-2">
                {upcoming.map((raid) => (
                  <RaidRow key={raid.id} raid={raid} myCharacters={myCharacters} />
                ))}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                Vergangene Raids ({past.length})
              </h2>
              <div className="space-y-2 opacity-60">
                {past.map((raid) => (
                  <RaidRow key={raid.id} raid={raid} myCharacters={myCharacters} isPast />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
