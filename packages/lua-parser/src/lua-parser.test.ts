import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLua, LuaParseError } from "./index.js";

test("parst primitive Werte", () => {
  const result = parseLua(`
    Config = {
      ["name"] = "Luna Wolves",
      ["count"] = 42,
      ["ratio"] = 1.5,
      ["negative"] = -7,
      ["scientific"] = 1.5e3,
      ["hex"] = 0xFF,
      ["enabled"] = true,
      ["disabled"] = false,
      ["empty"] = nil,
    }
  `);
  assert.deepEqual(result.Config, {
    name: "Luna Wolves",
    count: 42,
    ratio: 1.5,
    negative: -7,
    scientific: 1500,
    hex: 255,
    enabled: true,
    disabled: false,
    empty: null,
  });
});

test("erkennt sequentielle Tabellen als Array", () => {
  const result = parseLua(`Loot = { "Schwert", "Schild", "Helm" }`);
  assert.deepEqual(result.Loot, ["Schwert", "Schild", "Helm"]);
});

test("erkennt explizite zusammenhaengende numerische Schluessel als Array", () => {
  const result = parseLua(`Data = { [1] = "a", [2] = "b", [3] = "c" }`);
  assert.deepEqual(result.Data, ["a", "b", "c"]);
});

test("nicht zusammenhaengende numerische Schluessel ergeben ein Objekt", () => {
  const result = parseLua(`Data = { [1] = "a", [3] = "c" }`);
  assert.deepEqual(result.Data, { "1": "a", "3": "c" });
});

test("gemischte Schluessel ergeben ein Objekt", () => {
  const result = parseLua(`Data = { "erste", ["name"] = "Stani" }`);
  assert.deepEqual(result.Data, { "1": "erste", name: "Stani" });
});

test("leere Tabelle wird zu leerem Array", () => {
  const result = parseLua(`Empty = {}`);
  assert.deepEqual(result.Empty, []);
});

test("verschachtelte Tabellen", () => {
  const result = parseLua(`
    Guild = {
      ["members"] = {
        ["Stani"] = { ["level"] = 80, ["online"] = true },
      },
    }
  `);
  assert.deepEqual(result.Guild, {
    members: { Stani: { level: 80, online: true } },
  });
});

test("unterstuetzt unquotierte Schluessel", () => {
  const result = parseLua(`T = { name = "x", level = 5 }`);
  assert.deepEqual(result.T, { name: "x", level: 5 });
});

test("verarbeitet String-Escapes", () => {
  const result = parseLua('T = { ["s"] = "a\\nb\\tc\\"d\\"" }');
  assert.deepEqual(result.T, { s: 'a\nb\tc"d"' });
});

test("lange Strings ohne Escape-Verarbeitung", () => {
  const result = parseLua(String.raw`T = { ["s"] = [[a\tb]] }`);
  assert.deepEqual(result.T, { s: String.raw`a\tb` });
});

test("ignoriert Zeilen- und Blockkommentare", () => {
  const result = parseLua(`
    -- Zeilenkommentar
    Config = {
      ["a"] = 1, -- nach dem Wert
      --[[ Blockkommentar
           ueber mehrere Zeilen ]]
      ["b"] = 2,
    }
  `);
  assert.deepEqual(result.Config, { a: 1, b: 2 });
});

test("parst mehrere globale Variablen", () => {
  const result = parseLua(`
    First = { ["x"] = 1 }
    Second = { ["y"] = 2 }
  `);
  assert.deepEqual(result, { First: { x: 1 }, Second: { y: 2 } });
});

test("parst realistische SavedVariables", () => {
  const sv = [
    "LunaWolvesDB = {",
    '\t["version"] = 3,',
    '\t["guild"] = "Luna Wolves",',
    '\t["members"] = {',
    '\t\t["Stani"] = {',
    '\t\t\t["class"] = "MAGE",',
    '\t\t\t["level"] = 80,',
    '\t\t\t["online"] = true,',
    "\t\t},",
    "\t},",
    '\t["recentLoot"] = {',
    '\t\t"Nerub-ar Brustplatte",',
    '\t\t"Cyrces Reif",',
    "\t},",
    "}",
  ].join("\n");
  assert.deepEqual(parseLua(sv), {
    LunaWolvesDB: {
      version: 3,
      guild: "Luna Wolves",
      members: {
        Stani: { class: "MAGE", level: 80, online: true },
      },
      recentLoot: ["Nerub-ar Brustplatte", "Cyrces Reif"],
    },
  });
});

test("entfernt ein fuehrendes UTF-8 BOM", () => {
  const result = parseLua(`﻿Config = { ["a"] = 1 }`);
  assert.deepEqual(result.Config, { a: 1 });
});

test("wirft LuaParseError bei nicht abgeschlossenem String", () => {
  assert.throws(() => parseLua('T = { ["s"] = "kein Ende }'), LuaParseError);
});

test("wirft LuaParseError bei fehlender schliessender Klammer", () => {
  assert.throws(() => parseLua(`T = { ["a"] = 1 `), LuaParseError);
});

test("wirft LuaParseError bei unerwartetem Zeichen", () => {
  assert.throws(() => parseLua(`T = @`), LuaParseError);
});

test("LuaParseError enthaelt Zeilen-Information", () => {
  try {
    parseLua(`T = {\n  ["a"] = @\n}`);
    assert.fail("parseLua haette werfen muessen");
  } catch (err) {
    assert.ok(err instanceof LuaParseError);
    assert.equal(err.line, 2);
  }
});
