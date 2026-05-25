import { apiFetch } from "@/lib/api";
import { SettingsForm } from "./SettingsForm";
import type { Guild } from "@/lib/guild";

interface GuildSettings {
  guildId: string;
  raidChannelId: string | null;
  dkpChannelId: string | null;
  adminRoleIds: string[];
  editorRoleIds: string[];
}

export default async function SettingsPage() {
  let allGuilds: Guild[] = [];
  let primaryGuild: Guild | null = null;
  let settings: GuildSettings | null = null;
  let forbidden = false;

  try {
    allGuilds = await apiFetch<Guild[]>("/guilds");
    primaryGuild = allGuilds.find((g) => g.isPrimary) ?? allGuilds[0] ?? null;
  } catch {}

  if (primaryGuild) {
    try {
      settings = await apiFetch<GuildSettings>(`/guilds/${primaryGuild.id}/settings`);
    } catch (e) {
      if ((e as Error).message.includes("403")) {
        forbidden = true;
      }
    }
  }

  if (forbidden) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Einstellungen</h1>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-xl">
          <p className="text-zinc-400 text-sm">
            Du hast keine Berechtigung, die Einstellungen zu sehen.
          </p>
          <p className="text-zinc-600 text-xs mt-2">
            Benötigt: Admin-Rolle in Discord + verknüpftes Discord-Konto
          </p>
        </div>
      </div>
    );
  }

  if (!primaryGuild) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Einstellungen</h1>
        <p className="text-zinc-500 text-sm">Noch keine Gilde eingerichtet.</p>
      </div>
    );
  }

  const initial = settings ?? {
    guildId: primaryGuild.id,
    raidChannelId: null,
    dkpChannelId: null,
    adminRoleIds: [],
    editorRoleIds: [],
  };

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-2xl font-bold">Einstellungen</h1>
        <span className="text-zinc-500 text-sm">{primaryGuild.name}</span>
      </div>

      <SettingsForm guildId={primaryGuild.id} initial={initial} allGuilds={allGuilds} />
    </div>
  );
}
