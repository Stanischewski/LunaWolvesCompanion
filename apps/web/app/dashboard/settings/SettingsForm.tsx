"use client";

import { useActionState } from "react";
import { saveSettings, type ActionState } from "./actions";

interface GuildSettings {
  raidChannelId: string | null;
  adminRoleIds: string[];
  editorRoleIds: string[];
}

interface Props {
  guildId: string;
  initial: GuildSettings;
}

function inputCls() {
  return "w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500";
}

function textareaCls() {
  return `${inputCls()} font-mono resize-none`;
}

export function SettingsForm({ guildId, initial }: Props) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(
    saveSettings.bind(null, guildId),
    null,
  );

  return (
    <form action={dispatch} className="space-y-6 max-w-xl">
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
  );
}
