import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { issueCode, redeemCode, safeCompare, _resetCodes } from "./authCodes.js";

describe("Einmal-Codes", () => {
  beforeEach(() => _resetCodes());

  it("gibt die hinterlegte Nutzlast zurück", () => {
    const code = issueCode("jwt-inhalt");
    assert.equal(redeemCode(code), "jwt-inhalt");
  });

  it("ist nur EINMAL einlösbar", () => {
    const code = issueCode("geheim");
    assert.equal(redeemCode(code), "geheim");
    assert.equal(redeemCode(code), null, "zweite Einlösung muss scheitern");
  });

  it("weist unbekannte Codes ab", () => {
    issueCode("a");
    assert.equal(redeemCode("erfunden"), null);
  });

  it("weist leere und übermäßig lange Codes ab", () => {
    assert.equal(redeemCode(""), null);
    assert.equal(redeemCode("x".repeat(300)), null);
  });

  it("erzeugt für gleiche Nutzlast verschiedene Codes", () => {
    const a = issueCode("gleich");
    const b = issueCode("gleich");
    assert.notEqual(a, b);
    assert.equal(redeemCode(a), "gleich");
    assert.equal(redeemCode(b), "gleich");
  });

  it("liefert ausreichend lange, URL-sichere Codes", () => {
    const code = issueCode("x");
    assert.ok(code.length >= 40, `zu kurz: ${code.length}`);
    assert.match(code, /^[A-Za-z0-9_-]+$/, "muss base64url sein");
  });

  it("verbraucht einen abgelaufenen Code trotzdem", () => {
    // Nach Ablauf darf weder die Nutzlast kommen noch der Eintrag liegenbleiben.
    const code = issueCode("alt");
    assert.equal(redeemCode(code), "alt");
    assert.equal(redeemCode(code), null);
  });
});

describe("safeCompare", () => {
  it("erkennt Gleichheit und Ungleichheit", () => {
    assert.equal(safeCompare("abc", "abc"), true);
    assert.equal(safeCompare("abc", "abd"), false);
    assert.equal(safeCompare("abc", "abcd"), false);
    assert.equal(safeCompare("", ""), true);
  });
});
