"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface LiveEvent {
  id: number;
  type: "member_seen" | "raid_signup";
  label: string;
  ts: Date;
}

let eventId = 0;

export function LiveFeed({ guildId }: { guildId: string }) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(API_URL, { path: "/ws", transports: ["websocket"] });

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join:guild", guildId);
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("member_seen", (data: { updated: number }) => {
      setEvents((prev) =>
        [
          {
            id: ++eventId,
            type: "member_seen" as const,
            label: `Addon-Sync — ${data.updated} Charakter(e) aktualisiert`,
            ts: new Date(),
          },
          ...prev,
        ].slice(0, 15),
      );
    });

    socket.on("raid_signup", (data: { role: string; status: string }) => {
      const roleLabel = { tank: "Tank", heal: "Heiler", dps: "DPS" }[data.role] ?? data.role;
      const statusLabel = { yes: "Zusage", maybe: "Vielleicht", no: "Absage" }[data.status] ?? data.status;
      setEvents((prev) =>
        [
          {
            id: ++eventId,
            type: "raid_signup" as const,
            label: `Raid-Anmeldung — ${roleLabel} · ${statusLabel}`,
            ts: new Date(),
          },
          ...prev,
        ].slice(0, 15),
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [guildId]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-300">Live-Events</h3>
        <span
          className={`inline-flex items-center gap-1.5 text-xs ${connected ? "text-emerald-400" : "text-zinc-500"}`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`}
          />
          {connected ? "Verbunden" : "Getrennt"}
        </span>
      </div>
      {events.length === 0 ? (
        <p className="text-xs text-zinc-600">Warte auf Events…</p>
      ) : (
        <ul className="space-y-1">
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="text-zinc-600 tabular-nums shrink-0">
                {e.ts.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span
                className={
                  e.type === "raid_signup" ? "text-violet-400" : "text-emerald-400"
                }
              >
                {e.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
