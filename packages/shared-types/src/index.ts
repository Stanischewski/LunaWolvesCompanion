// === Player & Characters ===

export interface Player {
  id: string;
  bnetId: string;
  bnetTag: string;
  discordId?: string;
  createdAt: Date;
}

export interface Character {
  id: string;
  playerId: string;
  guildId: string;
  name: string;
  realm: string;
  class: WowClass;
  level: number;
  itemLevel: number;
  mPlusScore: number;
  lastLogin: Date;
  guildRank: number;
}

// === Guild ===

export interface Guild {
  id: string;
  name: string;
  realm: string;
  faction: "alliance" | "horde";
  memberCount: number;
}

// === Enums ===

export type WowClass =
  | "warrior" | "paladin" | "hunter" | "rogue"
  | "priest" | "shaman" | "mage" | "warlock"
  | "monk" | "druid" | "demon_hunter"
  | "death_knight" | "evoker";

export type RaidRole = "tank" | "heal" | "dps";

export type SignupStatus = "yes" | "maybe" | "no";