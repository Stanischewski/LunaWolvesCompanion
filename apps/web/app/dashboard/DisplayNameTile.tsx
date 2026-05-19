"use client";
import { useState, useTransition } from "react";
import { setDisplayNameAction } from "./actions";

export function DisplayNameTile({ current }: { current: string | null }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await setDisplayNameAction(formData);
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fehler beim Speichern");
      }
    });
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Anzeigename</p>
      {editing ? (
        <form action={submit} className="mt-1 flex items-center gap-2">
          <input
            name="displayName"
            defaultValue={current ?? ""}
            maxLength={64}
            autoFocus
            placeholder="z.B. Stani"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={pending}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-2 py-1 transition-colors"
          >
            {pending ? "…" : "OK"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ✕
          </button>
          {error && <p className="text-red-400 text-xs">{error}</p>}
        </form>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="mt-1 flex items-center gap-2 group"
        >
          <span className="text-xl font-semibold text-zinc-100 group-hover:text-white transition-colors">
            {current ?? <span className="text-zinc-500 text-base font-normal">nicht gesetzt</span>}
          </span>
          <span className="text-zinc-600 text-xs group-hover:text-zinc-400 transition-colors">✎</span>
        </button>
      )}
    </div>
  );
}
