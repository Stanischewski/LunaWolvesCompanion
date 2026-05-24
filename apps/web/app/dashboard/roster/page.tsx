import { apiFetch } from "@/lib/api";
import { resolveGuild } from "@/lib/guild";
import { RosterTable } from "./RosterTable";

interface Member {
  id: string;
  name: string;
  realm: string;
  class: string;
  level: number;
  itemLevel: number;
  mPlusScore: number;
  guildRank: number;
  player: { bnetTag: string; displayName: string | null } | null;
}

export default async function RosterPage() {
  const guild = await resolveGuild().catch(() => null);
  let members: Member[] = [];

  const [membersResult, classIcons] = await Promise.all([
    guild
      ? apiFetch<Member[]>(`/guilds/${guild.id}/members`).catch(() => [] as Member[])
      : Promise.resolve([] as Member[]),
    apiFetch<Record<string, string>>("/class-icons").catch(() => ({} as Record<string, string>)),
  ]);
  members = membersResult;

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-2xl font-bold">Roster</h1>
        {guild && (
          <span className="text-zinc-500 text-sm">
            {guild.name} – {guild.realm} · {members.length} Mitglieder
          </span>
        )}
      </div>

      {!guild ? (
        <p className="text-zinc-500">Noch keine Gilde eingerichtet.</p>
      ) : members.length === 0 ? (
        <p className="text-zinc-500">Keine Characters in der Gilde.</p>
      ) : (
        <RosterTable members={members} classIcons={classIcons} />
      )}
    </div>
  );
}
