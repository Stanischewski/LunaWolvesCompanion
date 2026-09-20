import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * Verschluesselung fuer Battle.net-Access-Tokens (at rest).
 *
 * Bei einem Datenbank-Leak waren die Tokens bisher im Klartext abgreifbar und
 * damit fremde Battle.net-Profile mit `wow.profile`-Scope lesbar.
 *
 * Format: `enc:v1:<iv>:<authTag>:<ciphertext>`, alles base64url.
 * AES-256-GCM, Schluessel aus TOKEN_ENCRYPTION_KEY.
 *
 * Uebergang fuer Bestandsdaten: `decryptToken` gibt einen Wert ohne das
 * `enc:v1:`-Praefix unveraendert zurueck. Bereits gespeicherte Klartext-Tokens
 * funktionieren also weiter und werden beim naechsten Login ersetzt — es
 * braucht keine Migration und keinen Stichtag.
 */

const PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;
let warned = false;

function getKey(): Buffer | null {
  if (cachedKey) return cachedKey;

  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;

  // 64 Hex-Zeichen = 32 Byte werden direkt verwendet, alles andere wird
  // ueber SHA-256 auf die noetige Schluessellaenge gebracht.
  cachedKey = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : createHash("sha256").update(raw).digest();
  return cachedKey;
}

/** true, wenn ein Schluessel konfiguriert ist. */
export function encryptionEnabled(): boolean {
  return getKey() !== null;
}

export function encryptToken(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return null;

  const key = getKey();
  if (!key) {
    if (!warned) {
      warned = true;
      console.warn(
        "[Crypto] TOKEN_ENCRYPTION_KEY ist nicht gesetzt — Battle.net-Tokens werden im Klartext gespeichert.",
      );
    }
    return plain;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return (
    PREFIX +
    [iv, authTag, ciphertext].map((b) => b.toString("base64url")).join(":")
  );
}

export function decryptToken(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === "") return null;

  // Bestandsdaten ohne Praefix sind Klartext — unveraendert zurueckgeben.
  if (!stored.startsWith(PREFIX)) return stored;

  const key = getKey();
  if (!key) {
    console.error("[Crypto] Verschlüsselter Token, aber TOKEN_ENCRYPTION_KEY fehlt.");
    return null;
  }

  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || !dataB64) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Falscher Schluessel oder manipulierter Wert — nicht verwendbar.
    console.error("[Crypto] Battle.net-Token konnte nicht entschlüsselt werden.");
    return null;
  }
}

/** Nur fuer Tests: erzwingt das Neulesen von TOKEN_ENCRYPTION_KEY. */
export function _resetKeyCache(): void {
  cachedKey = null;
  warned = false;
}
