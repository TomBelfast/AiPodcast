import fs from "fs";
import path from "path";

/** Czyta zmienne z pliku .env (fallback gdy process.env nieaktualne). */
export function readEnv(): Record<string, string> {
  try {
    const p = path.resolve(process.cwd(), "../../.env");
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=['"]?(.+?)['"]?\s*$/);
      if (m) out[m[1]!] = m[2]!;
    }
    return out;
  } catch {
    return {};
  }
}

export function cfg(key: string, fallback = ""): string {
  return process.env[key] || readEnv()[key] || fallback;
}
