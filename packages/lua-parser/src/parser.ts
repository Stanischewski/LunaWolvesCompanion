import type { LuaValue } from "./types.js";
import { LuaParseError } from "./errors.js";
import { tokenize, type Token } from "./lexer.js";

const KEYWORDS = new Set(["true", "false", "nil"]);

/** Schutz gegen Stack-Overflow durch absichtlich tief verschachtelte Eingaben. */
const MAX_DEPTH = 200;

/**
 * Parst eine WoW-SavedVariables-Datei (Lua) in ein JSON-kompatibles Objekt.
 * Liefert eine Map aller globalen Variablen auf ihre Werte.
 */
export function parseLua(source: string): Record<string, LuaValue> {
  const cleaned = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  return new Parser(tokenize(cleaned)).parseChunk();
}

interface TableEntry {
  key: string | number | null;
  value: LuaValue;
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parseChunk(): Record<string, LuaValue> {
    const result: Record<string, LuaValue> = {};
    while (!this.isEof()) {
      const name = this.peek();
      if (name.type !== "name" || KEYWORDS.has(name.value)) {
        this.error("Globale Variablenzuweisung erwartet", name);
      }
      this.advance();
      this.expectPunct("=");
      result[name.value] = this.parseValue();
      if (this.isPunct(";")) this.advance();
    }
    return result;
  }

  private parseValue(): LuaValue {
    const token = this.peek();
    if (token.type === "string") {
      this.advance();
      return token.value;
    }
    if (token.type === "number") {
      this.advance();
      return token.numberValue;
    }
    if (token.type === "punct") {
      if (token.value === "{") return this.parseTable();
      if (token.value === "-") {
        this.advance();
        const inner = this.parseValue();
        if (typeof inner !== "number") {
          this.error("Zahl nach '-' erwartet", token);
        }
        return -inner;
      }
      this.error(`Unerwartetes Token '${token.value}'`, token);
    }
    if (token.type === "name") {
      if (token.value === "true") {
        this.advance();
        return true;
      }
      if (token.value === "false") {
        this.advance();
        return false;
      }
      if (token.value === "nil") {
        this.advance();
        return null;
      }
      this.error(`Unerwarteter Bezeichner '${token.value}'`, token);
    }
    this.error("Unerwartetes Dateiende", token);
  }

  private parseTable(): LuaValue {
    if (++this.depth > MAX_DEPTH) {
      this.error(`Maximale Verschachtelungstiefe von ${MAX_DEPTH} ueberschritten`);
    }
    this.expectPunct("{");
    const entries: TableEntry[] = [];
    while (!this.isPunct("}")) {
      if (this.isEof()) this.error("'}' erwartet");
      entries.push(this.parseTableEntry());
      if (this.isPunct(",") || this.isPunct(";")) {
        this.advance();
      } else if (!this.isPunct("}")) {
        this.error("',' oder '}' erwartet");
      }
    }
    this.expectPunct("}");
    this.depth--;
    return buildTable(entries);
  }

  private parseTableEntry(): TableEntry {
    if (this.isPunct("[")) {
      this.advance();
      const key = this.parseValue();
      if (typeof key !== "string" && typeof key !== "number") {
        this.error("Tabellenschluessel muss ein String oder eine Zahl sein");
      }
      this.expectPunct("]");
      this.expectPunct("=");
      return { key, value: this.parseValue() };
    }
    const token = this.peek();
    if (token.type === "name" && !KEYWORDS.has(token.value) && this.isPunct("=", 1)) {
      this.advance();
      this.advance();
      return { key: token.value, value: this.parseValue() };
    }
    return { key: null, value: this.parseValue() };
  }

  private peek(offset = 0): Token {
    const at = this.index + offset;
    return this.tokens[at < this.tokens.length ? at : this.tokens.length - 1];
  }

  private advance(): Token {
    return this.tokens[this.index++];
  }

  private isEof(): boolean {
    return this.peek().type === "eof";
  }

  private isPunct(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.type === "punct" && token.value === value;
  }

  private expectPunct(value: string): void {
    const token = this.peek();
    if (token.type !== "punct" || token.value !== value) {
      this.error(`'${value}' erwartet`, token);
    }
    this.advance();
  }

  private error(message: string, token: Token = this.peek()): never {
    throw new LuaParseError(message, token.line, token.column);
  }
}

/**
 * Wandelt geparste Tabelleneintraege in einen JS-Wert um. Lua-Tabellen sind
 * Array und Map zugleich: nur zusammenhaengende Integer-Schluessel ab 1 werden
 * als JS-Array dargestellt, alles andere als Objekt.
 */
function buildTable(entries: TableEntry[]): LuaValue {
  const map = new Map<string | number, LuaValue>();
  let nextIndex = 1;
  let hasStringKey = false;

  for (const entry of entries) {
    const key = entry.key === null ? nextIndex++ : entry.key;
    if (typeof key === "string") hasStringKey = true;
    map.set(key, entry.value);
  }

  if (!hasStringKey) {
    let contiguous = true;
    for (let i = 1; i <= map.size; i++) {
      if (!map.has(i)) {
        contiguous = false;
        break;
      }
    }
    if (contiguous) {
      const array: LuaValue[] = [];
      for (let i = 1; i <= map.size; i++) array.push(map.get(i)!);
      return array;
    }
  }

  const object: { [key: string]: LuaValue } = {};
  for (const [key, value] of map) object[String(key)] = value;
  return object;
}
