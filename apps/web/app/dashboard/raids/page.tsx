import { apiFetch } from "@/lib/api";
import { resolveGuild } from "@/lib/guild";
import { RaidsClient } from "./RaidsClient";

interface RaidEvent {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  raidType: string | null;
  minIlvl: number | null;
  signups: { raidEventId: string; characterId: string; role: "tank" | "heal" | "dps"; status: "yes" | "maybe" | "no"; character: { id: string; name: string; class: string; itemLevel: number } }[];
}

interface MyCharacter {
  id: string;
  name: string;
  class: string;
}

export default async function RaidsPage() {
  const guild = await resolveGuild().catch(() => null);

  if (!guild) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Raids</h1>
        <p className="text-zinc-500">Noch keine Gilde eingerichtet.</p>
      </div>
    );
  }

  const [raids, playerData, classIcons] = await Promise.all([
    apiFetch<RaidEvent[]>(`/guilds/${guild.id}/raids`).catch(() => [] as RaidEvent[]),
    apiFetch<{ characters: MyCharacter[] }>("/players/me").catch(() => null),
    apiFetch<Record<string, string>>("/class-icons").catch(() => ({} as Record<string, string>)),
  ]);

  const myCharacters = playerData?.characters ?? [];

  return (
    <RaidsClient guild={guild} raids={raids} myCharacters={myCharacters} classIcons={classIcons} />
  );
}
