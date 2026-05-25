"use client";

import { useActionState } from "react";
import { saveSettings, setPrimaryGuild, type ActionState } from "./actions";
import type { Guild } from "@/lib/guild";

interface GuildSettings {
  raidChannelId: string | null;
  dkpChannelId: string | null;
  adminRoleIds: string[];
  editorRoleIds: string[];
}

interface Props {
  guildId: string;
  initial: GuildSettings;
  allGuilds: Guild[];
}

function inputCls() {
  return "w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500";
}

function textareaCls() {
  return `${inputCls()} font-mono resize-none`;
}

function GuildSelector({ allGuilds }: { allGuilds: Guild[] }) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(setPrimaryGuild, null);
  if (allGuilds.length <= 1) return null;
  return (
    <form action={dispatch} className="space-y-3">
      <div className="space-y-2">
        {allGuilds.map((g) => (
          <label key={g.id} className="flex items-center gap-3 cursor-pointer group">
            <input
              type="radio"
              name="guildId"
              value={g.id}
              defaultChecked={g.isPrimary}
              className="accent-blue-500"
            />
            <span className="text-sm text-zinc-200 group-hover:text-zinc-100">
              {g.name}
              <span className="text-zinc-500 ml-1 text-xs">{g.realm}</span>
            </span>
            {g.isPrimary && (
              <span className="text-xs bg-blue-600/20 text-blue-400 border border-blue-600/30 rounded px-1.5 py-0.5">
                aktiv
              </span>
            )}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
        >
          {pending ? "Setze..." : "Als primäre Gilde setzen"}
        </button>
        {state?.success && <span className="text-sm text-green-400">{state.success}</span>}
        {state?.error && <span className="text-sm text-red-400">{state.error}</span>}
      </div>
    </form>
  );
}

export function SettingsForm({ guildId, initial, allGuilds }: Props) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(
    saveSettings.bind(null, guildId),
    null,
  );

  return (
    <div className="space-y-6 max-w-xl">
      {allGuilds.length > 1 && (
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Aktive Gilde
          </h2>
          <GuildSelector allGuilds={allGuilds} />
        </section>
      )}
    <form action={dispatch} className="contents">
      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          Discord-Kanäle
        </h2>

        <div>
          <label className="block text-sm text-zinc-300 mb-1">
            Raidkalender-Channel ID
          </label>
          <input
            name="raidChannelId"
            type="text"
            defaultValue={initial.raidChannelId ?? ""}
            placeholder="z.B. 123456789012345678"
            className={inputCls()}
          />
          <p className="text-xs text-zinc-600 mt-1">
            Rechtsklick auf den Channel → ID kopieren (Einstellungen → Erweitert → Entwicklermodus)
          </p>
        </div>

        <div>
          <label className="block text-sm text-zinc-300 mb-1">
            DKP-Liste Channel ID
          </label>
          <input
            name="dkpChannelId"
            type="text"
            defaultValue={initial.dkpChannelId ?? ""}
            placeholder="z.B. 123456789012345678"
            className={inputCls()}
          />
          <p className="text-xs text-zinc-600 mt-1">
            Der Bot postet hier alle 5 Minuten eine aktualisierte DKP-Übersicht aller Spieler.
          </p>
        </div>
      </section>

      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          Berechtigungen
        </h2>

        <div>
          <label className="block text-sm text-zinc-300 mb-1">
            Admin-Rollen IDs
            <span className="text-zinc-500 font-normal ml-1">(eine pro Zeile)</span>
          </label>
          <textarea
            name="adminRoleIds"
            defaultValue={initial.adminRoleIds.join("\n")}
            placeholder={"123456789012345678\n987654321098765432"}
            rows={3}
            className={textareaCls()}
          />
          <p className="text-xs text-zinc-600 mt-1">
            Dürfen alles: Einstellungen ändern, Events und DKP verwalten
          </p>
        </div>

        <div>
          <label className="block text-sm text-zinc-300 mb-1">
            Editor-Rollen IDs
            <span className="text-zinc-500 font-normal ml-1">(eine pro Zeile)</span>
          </label>
          <textarea
            name="editorRoleIds"
            defaultValue={initial.editorRoleIds.join("\n")}
            placeholder={"123456789012345678"}
            rows={3}
            className={textareaCls()}
          />
          <p className="text-xs text-zinc-600 mt-1">
            Dürfen Events erstellen/bearbeiten und DKP anpassen
          </p>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
        >
          {pending ? "Speichern..." : "Speichern"}
        </button>

        {state?.success && (
          <span className="text-sm text-green-400">{state.success}</span>
        )}
        {state?.error && (
          <span className="text-sm text-red-400">{state.error}</span>
        )}
      </div>
    </form>
    </div>
  );
}
