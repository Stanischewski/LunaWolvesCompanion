import { config } from "./config.js";

export interface GuildInfo {
  id: string;
  name: string;
  realm: string;
  faction: string;
  memberCount: number;
}

export interface MemberCharacter {
  id: string;
  name: string;
  realm: string;
  class: string;
  level: number;
  itemLevel: number;
  mPlusScore: number;
  lastLogin: string;
  guildRank: number;
  player?: { bnetTag: string };
}

export interface RaidEvent {
  id: string;
  title: string;
  scheduledAt: string;
  raidType?: string;
  minIlvl?: number;
  calendarMessageId?: string | null;
  signups?: RaidSignup[];
}

export interface RaidSignup {
  raidEventId: string;
  characterId: string;
  role: "tank" | "heal" | "dps";
  status: "yes" | "maybe" | "no";
  character?: MemberCharacter;
}

export interface BotSettings {
  guildId: string;
  raidChannelId: string | null;
  dkpChannelId: string | null;
  dkpMessageId: string | null;
}

export interface SignupBotResult {
  status: "signed_up" | "select_character" | "no_character";
  character?: { id: string; name: string; class: string };
  characters?: Array<{ id: string; name: string; class: string }>;
}

export interface DkpStanding {
  guildId: string;
  playerName: string;
  current: number;
  lifetime: number;
  updatedAt: string;
}

export interface DkpEntry {
  id: string;
  guildId: string;
  playerName: string;
  delta: number;
  reason: string;
  entryType: string;
  officerName: string;
  occurredAt: string;
  source: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${config.apiUrl}/api/v1${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-bot-secret": config.botSecret,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path}: ${res.status} — ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  bot: {
    settings: () => apiFetch<BotSettings>(`/bot/guilds/${config.lunaGuildId}/settings`),
    setDkpMessageId: (dkpMessageId: string | null) =>
      apiFetch<{ ok: boolean }>(`/bot/guilds/${config.lunaGuildId}/dkp-message`, {
        method: "PATCH",
        body: JSON.stringify({ dkpMessageId }),
      }),
  },
  guild: {
    get: () => apiFetch<GuildInfo>(`/guilds/${config.lunaGuildId}`),
    members: () => apiFetch<MemberCharacter[]>(`/guilds/${config.lunaGuildId}/members`),
    raids: () => apiFetch<RaidEvent[]>(`/guilds/${config.lunaGuildId}/raids`),
  },
  raid: {
    get: (id: string) => apiFetch<RaidEvent>(`/raids/${id}`),
    create: (body: { title: string; scheduledAt: string; raidType?: string; minIlvl?: number }) =>
      apiFetch<RaidEvent>(`/guilds/${config.lunaGuildId}/raids`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    signup: (id: string, body: { characterId: string; role: string; status?: string }) =>
      apiFetch<RaidSignup>(`/raids/${id}/signup`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    signupBot: (id: string, body: { discordId: string; role: string }) =>
      apiFetch<SignupBotResult>(`/bot/raids/${id}/signup`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    signupBotByChar: (id: string, body: { characterId: string; role: string }) =>
      apiFetch<{ status: string }>(`/bot/raids/${id}/signup-by-char`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    unregisterBot: (id: string, discordId: string) =>
      apiFetch<{ status: string }>(`/bot/raids/${id}/unregister`, {
        method: "POST",
        body: JSON.stringify({ discordId }),
      }),
    setCalendarMessageId: (id: string, calendarMessageId: string | null) =>
      apiFetch<RaidEvent>(`/bot/raids/${id}/calendar-message`, {
        method: "PATCH",
        body: JSON.stringify({ calendarMessageId }),
      }),
  },
  dkp: {
    standings: () =>
      apiFetch<DkpStanding[]>(`/guilds/${config.lunaGuildId}/dkp/standings`),
    player: (name: string) =>
      apiFetch<DkpStanding>(`/guilds/${config.lunaGuildId}/dkp/standings/${encodeURIComponent(name)}`),
    history: (player?: string) =>
      apiFetch<DkpEntry[]>(
        `/guilds/${config.lunaGuildId}/dkp/history?limit=10${player ? `&player=${encodeURIComponent(player)}` : ""}`,
      ),
    award: (playerName: string, amount: number, reason: string) =>
      apiFetch<DkpEntry>(`/guilds/${config.lunaGuildId}/dkp/award`, {
        method: "POST",
        body: JSON.stringify({ playerName, amount, reason }),
      }),
    spend: (playerName: string, amount: number, reason: string) =>
      apiFetch<DkpEntry>(`/guilds/${config.lunaGuildId}/dkp/spend`, {
        method: "POST",
        body: JSON.stringify({ playerName, amount, reason }),
      }),
  },
};
