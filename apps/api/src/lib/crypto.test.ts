import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { encryptToken, decryptToken, encryptionEnabled, _resetKeyCache } from "./crypto.js";

const KEY = "a".repeat(64);

function withKey(key: string | undefined, fn: () => void): void {
  const previous = process.env.TOKEN_ENCRYPTION_KEY;
  if (key === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = key;
  _resetKeyCache();
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previous;
    _resetKeyCache();
  }
}

describe("Token-Verschlüsselung", () => {
  beforeEach(() => _resetKeyCache());

  it("verschlüsselt und entschlüsselt verlustfrei", () => {
    withKey(KEY, () => {
      const plain = "EUTOKEN-abc123";
      const enc = encryptToken(plain);
      assert.notEqual(enc, plain, "darf nicht im Klartext bleiben");
      assert.ok(enc!.startsWith("enc:v1:"));
      assert.equal(decryptToken(enc), plain);
    });
  });

  it("erzeugt bei gleichem Klartext verschiedene Chiffrate", () => {
    withKey(KEY, () => {
      // Gleicher Input, unterschiedliche IV — sonst wären gleiche Tokens
      // in der Datenbank als solche erkennbar.
      assert.notEqual(encryptToken("gleich"), encryptToken("gleich"));
    });
  });

  it("gibt Bestandsdaten im Klartext unverändert zurück", () => {
    withKey(KEY, () => {
      // Migration ohne Stichtag: alte Zeilen ohne Präfix bleiben nutzbar.
      assert.equal(decryptToken("alter-klartext-token"), "alter-klartext-token");
    });
  });

  it("erkennt Manipulation am Chiffrat", () => {
    withKey(KEY, () => {
      const enc = encryptToken("geheim")!;
      const parts = enc.split(":");
      // Letztes Zeichen des Ciphertexts kippen
      const last = parts[4];
      parts[4] = last.slice(0, -1) + (last.endsWith("A") ? "B" : "A");
      assert.equal(decryptToken(parts.join(":")), null, "GCM muss anschlagen");
    });
  });

  it("gibt mit falschem Schlüssel null zurück statt Müll", () => {
    let enc: string | null = null;
    withKey(KEY, () => {
      enc = encryptToken("geheim");
    });
    withKey("b".repeat(64), () => {
      assert.equal(decryptToken(enc), null);
    });
  });

  it("akzeptiert auch eine Passphrase als Schlüssel", () => {
    withKey("irgendeine lange passphrase", () => {
      assert.equal(encryptionEnabled(), true);
      const enc = encryptToken("x");
      assert.equal(decryptToken(enc), "x");
    });
  });

  it("bleibt ohne Schlüssel funktionsfähig (Klartext)", () => {
    withKey(undefined, () => {
      assert.equal(encryptionEnabled(), false);
      assert.equal(encryptToken("roh"), "roh");
      assert.equal(decryptToken("roh"), "roh");
    });
  });

  it("behandelt leere Werte einheitlich", () => {
    withKey(KEY, () => {
      assert.equal(encryptToken(null), null);
      assert.equal(encryptToken(""), null);
      assert.equal(decryptToken(null), null);
      assert.equal(decryptToken(""), null);
    });
  });
});
