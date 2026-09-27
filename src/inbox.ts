import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FetchResult } from "./fetch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INBOX_DIR = path.resolve(__dirname, "..", "inbox");

/**
 * Optional manual paste override: `inbox/<restaurantId>.txt`
 * Useful when Facebook truncates posts behind login / "Továbbiak".
 */
export async function loadInboxOverride(restaurantId: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(INBOX_DIR, `${restaurantId}.txt`), "utf8");
    const text = raw.trim();
    return text.length ? text : null;
  } catch {
    return null;
  }
}

export async function applyInboxOverride(
  restaurantId: string,
  fetched: FetchResult,
): Promise<FetchResult> {
  const inbox = await loadInboxOverride(restaurantId);
  if (!inbox) return fetched;
  console.log(`(using inbox/${restaurantId}.txt)`);
  return {
    ...fetched,
    text: inbox,
    // Prefer pasted text; keep screenshots as secondary signal for Gemini fallback
  };
}
