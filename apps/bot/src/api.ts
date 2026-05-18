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
  signups?: RaidSignup[];
}

export interface RaidSignup {
  raidEventId: string;
  characterId: string;
  role: "tank" | "heal" | "dps";
  status: "yes" | "maybe" | "no";
  character?: MemberCharacter;
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
