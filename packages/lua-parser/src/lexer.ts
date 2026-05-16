import { LuaParseError } from "./errors.js";

export type Token =
  | { type: "string"; value: string; line: number; column: number }
  | { type: "number"; value: string; numberValue: number; line: number; column: number }
  | { type: "name"; value: string; line: number; column: number }
  | { type: "punct"; value: string; line: number; column: number }
  | { type: "eof"; value: string; line: number; column: number };

const SIMPLE_ESCAPES: Record<string, string> = {
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\\": "\\",
  '"': '"',
  "'": "'",
};

export function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize();
}

class Lexer {
  private pos = 0;
  private line = 1;
  private column = 1;

  constructor(private readonly src: string) {}

  tokenize(): Token[] {
    const tokens: Token[] = [];
    for (;;) {
      this.skipTrivia();
      const line = this.line;
      const column = this.column;
      if (this.pos >= this.src.length) {
        tokens.push({ type: "eof", value: "", line, column });
        return tokens;
      }
      const c = this.src[this.pos];
      if (c === '"' || c === "'") {
        tokens.push({ type: "string", value: this.readShortString(), line, column });
      } else if (c === "[") {
        const level = this.longBracketLevel(this.pos);
        if (level >= 0) {
          this.skip(level + 2);
          tokens.push({ type: "string", value: this.readLongString(level), line, column });
        } else {
          this.advance();
          tokens.push({ type: "punct", value: "[", line, column });
        }
      } else if (this.isDigit(c) || (c === "." && this.isDigit(this.src[this.pos + 1]))) {
        tokens.push(this.readNumber(line, column));
      } else if (this.isNameStart(c)) {
        tokens.push({ type: "name", value: this.readName(), line, column });
      } else if (c === "{" || c === "}" || c === "]" || c === "=" || c === "," || c === ";" || c === "-") {
        this.advance();
        tokens.push({ type: "punct", value: c, line, column });
      } else {
        throw new LuaParseError(`Unerwartetes Zeichen '${c}'`, line, column);
      }
    }
  }

  private advance(): void {
    if (this.src[this.pos] === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    this.pos++;
  }

  private skip(count: number): void {
    for (let k = 0; k < count; k++) this.advance();
  }

  private isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
  }

  private isHexDigit(c: string): boolean {
    return (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
  }

  private isNameStart(c: string): boolean {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  }

  private isNamePart(c: string): boolean {
    return this.isNameStart(c) || this.isDigit(c);
  }

  private skipTrivia(): void {
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\v" || c === "\f") {
        this.advance();
      } else if (c === "-" && this.src[this.pos + 1] === "-") {
        this.advance();
        this.advance();
        const level = this.longBracketLevel(this.pos);
        if (level >= 0) {
          this.skip(level + 2);
          this.readLongString(level);
        } else {
          while (this.pos < this.src.length && this.src[this.pos] !== "\n") this.advance();
        }
      } else {
        break;
      }
    }
  }

  private longBracketLevel(at: number): number {
    if (this.src[at] !== "[") return -1;
    let k = at + 1;
    while (this.src[k] === "=") k++;
    return this.src[k] === "[" ? k - at - 1 : -1;
  }

  private readLongString(level: number): string {
    if (this.src[this.pos] === "\r") this.advance();
    if (this.src[this.pos] === "\n") this.advance();
    const close = `]${"=".repeat(level)}]`;
    let out = "";
    while (!this.src.startsWith(close, this.pos)) {
      if (this.pos >= this.src.length) {
        throw new LuaParseError("Nicht abgeschlossene lange Klammer", this.line, this.column);
      }
      out += this.src[this.pos];
      this.advance();
    }
    this.skip(close.length);
    return out;
  }

  private readShortString(): string {
    const quote = this.src[this.pos];
    const startLine = this.line;
    const startColumn = this.column;
    this.advance();
    let out = "";
    for (;;) {
      if (this.pos >= this.src.length) {
        throw new LuaParseError("Nicht abgeschlossener String", startLine, startColumn);
      }
      const c = this.src[this.pos];
      if (c === quote) {
        this.advance();
        return out;
      }
      if (c === "\n") {
        throw new LuaParseError("Zeilenumbruch in String", this.line, this.column);
      }
      if (c === "\\") {
        this.advance();
        out += this.readEscape();
      } else {
        out += c;
        this.advance();
      }
    }
  }

  private readEscape(): string {
    if (this.pos >= this.src.length) {
      throw new LuaParseError("Nicht abgeschlossener String", this.line, this.column);
    }
    const c = this.src[this.pos];
    if (c === "\n" || c === "\r") {
      this.advance();
      if (c === "\r" && this.src[this.pos] === "\n") this.advance();
      return "\n";
    }
    if (c === "z") {
      this.advance();
      while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.advance();
      return "";
    }
    if (c === "x") {
      this.advance();
      let hex = "";
      while (hex.length < 2 && this.isHexDigit(this.src[this.pos])) {
        hex += this.src[this.pos];
        this.advance();
      }
      if (hex.length === 0) {
        throw new LuaParseError("Ungueltige \\x-Escape-Sequenz", this.line, this.column);
      }
      return String.fromCharCode(parseInt(hex, 16));
    }
    if (c === "u") {
      this.advance();
      if (this.src[this.pos] !== "{") {
        throw new LuaParseError("Ungueltige \\u-Escape-Sequenz", this.line, this.column);
      }
      this.advance();
      let hex = "";
      while (this.isHexDigit(this.src[this.pos])) {
        hex += this.src[this.pos];
        this.advance();
      }
      if (hex.length === 0 || this.src[this.pos] !== "}") {
        throw new LuaParseError("Ungueltige \\u-Escape-Sequenz", this.line, this.column);
      }
      this.advance();
      return String.fromCodePoint(parseInt(hex, 16));
    }
    if (this.isDigit(c)) {
      let dec = "";
      while (dec.length < 3 && this.isDigit(this.src[this.pos])) {
        dec += this.src[this.pos];
        this.advance();
      }
      return String.fromCharCode(parseInt(dec, 10));
    }
    this.advance();
    return SIMPLE_ESCAPES[c] ?? c;
  }

  private readName(): string {
    let text = "";
    while (this.pos < this.src.length && this.isNamePart(this.src[this.pos])) {
      text += this.src[this.pos];
      this.advance();
    }
    return text;
  }

  private readNumber(line: number, column: number): Token {
    if (this.src[this.pos] === "0" && (this.src[this.pos + 1] === "x" || this.src[this.pos + 1] === "X")) {
      const prefix = this.src[this.pos] + this.src[this.pos + 1];
      this.skip(2);
      let hex = "";
      while (this.pos < this.src.length && this.isHexDigit(this.src[this.pos])) {
        hex += this.src[this.pos];
        this.advance();
      }
      if (hex.length === 0) {
        throw new LuaParseError("Ungueltige Hexadezimalzahl", line, column);
      }
      return { type: "number", value: prefix + hex, numberValue: parseInt(hex, 16), line, column };
    }
    let text = "";
    while (this.pos < this.src.length && this.isDigit(this.src[this.pos])) {
      text += this.src[this.pos];
      this.advance();
    }
    if (this.src[this.pos] === ".") {
      text += ".";
      this.advance();
      while (this.pos < this.src.length && this.isDigit(this.src[this.pos])) {
        text += this.src[this.pos];
        this.advance();
      }
    }
    if (this.src[this.pos] === "e" || this.src[this.pos] === "E") {
      text += this.src[this.pos];
      this.advance();
      if (this.src[this.pos] === "+" || this.src[this.pos] === "-") {
        text += this.src[this.pos];
        this.advance();
      }
      let expDigits = "";
      while (this.pos < this.src.length && this.isDigit(this.src[this.pos])) {
        expDigits += this.src[this.pos];
        this.advance();
      }
      if (expDigits.length === 0) {
        throw new LuaParseError("Ungueltiger Exponent in Zahl", line, column);
      }
      text += expDigits;
    }
    const numberValue = Number(text);
    if (Number.isNaN(numberValue)) {
      throw new LuaParseError(`Ungueltige Zahl '${text}'`, line, column);
    }
    return { type: "number", value: text, numberValue, line, column };
  }
}
