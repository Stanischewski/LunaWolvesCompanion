"use client";

import { useActionState } from "react";
import { awardDkp, spendDkp, resetSeason, type ActionState } from "./actions";

function StatusMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error)
    return <p className="text-red-400 text-sm mt-2">{state.error}</p>;
  return <p className="text-green-400 text-sm mt-2">{state.success}</p>;
}

function inputCls() {
  return "bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 w-full";
}

export function AwardForm({ guildId }: { guildId: string }) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(
    awardDkp.bind(null, guildId),
    null,
  );

  return (
    <form action={dispatch} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Spieler</label>
          <input name="playerName" placeholder="Arthas" className={inputCls()} required />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Betrag</label>
          <input name="amount" type="number" min="1" placeholder="10" className={inputCls()} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Grund</label>
          <input name="reason" placeholder="Manuell" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Typ</label>
          <select name="entryType" className={inputCls()}>
            <option value="manual">Manuell</option>
            <option value="boss">Bosskill</option>
            <option value="correction">Korrektur</option>
          </select>
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded transition-colors"
      >
        {pending ? "Wird verarbeitet…" : "DKP vergeben"}
      </button>
      <StatusMessage state={state} />
    </form>
  );
}

export function SpendForm({ guildId }: { guildId: string }) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(
    spendDkp.bind(null, guildId),
    null,
  );

  return (
    <form action={dispatch} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Spieler</label>
          <input name="playerName" placeholder="Arthas" className={inputCls()} required />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Betrag</label>
          <input name="amount" type="number" min="1" placeholder="50" className={inputCls()} required />
        </div>
      </div>
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Grund</label>
        <input name="reason" placeholder="Tier-Helm" className={inputCls()} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-sm rounded transition-colors"
      >
        {pending ? "Wird verarbeitet…" : "DKP abziehen"}
      </button>
      <StatusMessage state={state} />
    </form>
  );
}

export function ResetForm({ guildId }: { guildId: string }) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(
    resetSeason.bind(null, guildId),
    null,
  );

  return (
    <form action={dispatch} className="space-y-3">
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Season-Name (optional)</label>
        <input
          name="seasonName"
          placeholder={`Saison-${new Date().toISOString().slice(0, 10)}`}
          className={inputCls()}
        />
      </div>
      <p className="text-xs text-zinc-600">
        Setzt alle aktuellen DKP auf 0 und archiviert den Stand. Die History bleibt erhalten.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 text-sm rounded border border-zinc-600 transition-colors"
      >
        {pending ? "Wird verarbeitet…" : "Season Reset durchführen"}
      </button>
      <StatusMessage state={state} />
    </form>
  );
}
