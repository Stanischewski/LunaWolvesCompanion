import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { AwardForm, SpendForm, ResetForm } from "./DkpManageForms";

interface Guild {
  id: string;
  name: string;
}

export default async function DkpManagePage() {
  let guild: Guild | null = null;

  try {
    const guilds = await apiFetch<Guild[]>("/guilds");
    if (guilds.length > 0) guild = guilds[0];
  } catch {}

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-6">
        <Link href="/dashboard/dkp" className="text-zinc-500 hover:text-zinc-300 text-sm">
          ← DKP
        </Link>
        <h1 className="text-2xl font-bold">DKP verwalten</h1>
        {guild && <span className="text-zinc-500 text-sm">{guild.name}</span>}
      </div>

      {!guild ? (
        <p className="text-zinc-500">Noch keine Gilde eingerichtet.</p>
      ) : (
        <div className="space-y-6 max-w-2xl">
          <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
              DKP vergeben
            </h2>
            <AwardForm guildId={guild.id} />
          </section>

          <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
              DKP abziehen (Ausgabe)
            </h2>
            <SpendForm guildId={guild.id} />
          </section>

          <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 border-red-900/30">
            <h2 className="text-sm font-semibold text-red-400/70 uppercase tracking-wider mb-4">
              Season Reset
            </h2>
            <ResetForm guildId={guild.id} />
          </section>
        </div>
      )}
    </div>
  );
}
