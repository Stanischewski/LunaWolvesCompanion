import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cacheGet, cacheSet, cacheDelete, cacheSetIfAbsent, cacheStatus } from "./cache.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Cache (Speicher-Fallback ohne REDIS_URL)", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
  });

  it("speichert und liest Werte", async () => {
    await cacheSet("k1", "v1", 5_000);
    assert.equal(await cacheGet("k1"), "v1");
  });

  it("gibt für unbekannte Schlüssel null zurück", async () => {
    assert.equal(await cacheGet("gibtesnicht"), null);
  });

  it("lässt Werte nach der TTL verfallen", async () => {
    await cacheSet("kurz", "v", 30);
    assert.equal(await cacheGet("kurz"), "v");
    await sleep(60);
    assert.equal(await cacheGet("kurz"), null);
  });

  it("löscht Werte", async () => {
    await cacheSet("weg", "v", 5_000);
    await cacheDelete("weg");
    assert.equal(await cacheGet("weg"), null);
  });

  it("setIfAbsent greift nur beim ersten Mal", async () => {
    // Grundlage des Sync-Cooldowns: der zweite Versuch muss scheitern.
    assert.equal(await cacheSetIfAbsent("cooldown:x", "1", 1_000), true);
    assert.equal(await cacheSetIfAbsent("cooldown:x", "1", 1_000), false);
  });

  it("setIfAbsent greift nach Ablauf wieder", async () => {
    assert.equal(await cacheSetIfAbsent("cooldown:y", "1", 30), true);
    await sleep(60);
    assert.equal(await cacheSetIfAbsent("cooldown:y", "1", 30), true);
  });

  it("begrenzt den Speicherverbrauch", async () => {
    // Die alten Maps wuchsen unbegrenzt; hier greift eine feste Obergrenze.
    for (let i = 0; i < 6_000; i++) {
      await cacheSet(`bulk:${i}`, "v", 60_000);
    }
    const { memoryEntries } = cacheStatus();
    assert.ok(memoryEntries <= 5_000, `Obergrenze überschritten: ${memoryEntries}`);
  });

  it("meldet den aktiven Backend-Typ", () => {
    assert.equal(cacheStatus().backend, "memory");
  });
});
