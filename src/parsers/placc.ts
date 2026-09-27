import type { RestaurantMenu, Weekday } from "../types.js";

const DAY_MAP: Record<string, Weekday> = {
  h: "monday",
  hétfő: "monday",
  hetfo: "monday",
  k: "tuesday",
  kedd: "tuesday",
  sz: "wednesday",
  szerda: "wednesday",
  cs: "thursday",
  csütörtök: "thursday",
  csutortok: "thursday",
  p: "friday",
  péntek: "friday",
  pentek: "friday",
};

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Deterministic parser for Placc's Facebook "Heti menü" posts.
 * Returns null if the text does not look like a Placc weekly menu.
 */
export function parsePlaccMenuText(
  text: string,
  meta: { id: string; name: string; sourceUrl: string; fetchedAt: string },
): RestaurantMenu | null {
  const cleaned = text
    .replace(/\u00a0/g, " ")
    .replace(/…\s*Továbbiak/gi, "\n")
    .replace(/\bTovábbiak\b/gi, "")
    .replace(/See less/gi, "")
    .replace(/See more/gi, "")
    .trim();

  if (!/heti\s*menü/i.test(cleaned)) return null;

  const weekOf =
    cleaned.match(/heti\s*menü\s*\(([^)]+)\)/i)?.[1]?.trim() ?? null;

  const hetiMenuPrice = cleaned.match(/heti\s*menü\s*:\s*([0-9.\s]+ft)/i)?.[1]?.replace(/\s+/g, " ").trim();
  const napiMenuPrice = cleaned.match(/napi\s*menü\s*:\s*([0-9.\s]+ft)/i)?.[1]?.replace(/\s+/g, " ").trim();
  const desszertPrice = cleaned.match(/heti\s*desszert\s*:\s*([0-9.\s]+ft)/i)?.[1]?.replace(/\s+/g, " ").trim();

  const standingItems: string[] = [];
  const days: RestaurantMenu["days"] = {};

  // Section titles are text keywords; ignore any leading decoration
  const headerRe =
    /^[^\S\n]*[^A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]*?(Levesek|Főételek|Foetelek|Heti\s*desszert|Hétfő|Hetfo|Kedd|Szerda|Csütörtök|Csutortok|Péntek|Pentek)\b(?:\s*\(([^)]*)\))?\s*:?\s*(.*)$/imu;

  const lines = cleaned.split(/\r?\n/);
  type Section = { kind: string; paren: string; inline: string; lines: string[] };
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    headerRe.lastIndex = 0;
    const hm = headerRe.exec(line);
    if (hm) {
      current = {
        kind: hm[1],
        paren: (hm[2] || "").trim(),
        inline: (hm[3] || "").trim(),
        lines: [],
      };
      sections.push(current);
      continue;
    }

    if (current) current.lines.push(line);
  }

  for (const section of sections) {
    const kind = fold(section.kind);
    const body = [...(section.inline ? [section.inline] : []), ...section.lines]
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^(árai|az ár|ételeink|tetszik|hozzászólás|az összes)/i.test(l))
      .filter((l) => !/heti\s*menü\s*:/i.test(l))
      .filter((l) => !/napi\s*menü\s*:/i.test(l))
      .filter((l) => !/^heti\s*desszert\s*:\s*\d/i.test(l));

    if (kind === "levesek") {
      for (const dish of body) standingItems.push(`Leves: ${dish}`);
      continue;
    }
    if (kind === "foetelek") {
      for (const dish of body) standingItems.push(`Főétel: ${dish}`);
      continue;
    }
    if (kind === "heti desszert") {
      const name = body[0]?.replace(/\s*\d[\d.\s]*ft.*/i, "").trim();
      if (name && !/^\d/.test(name)) standingItems.push(`Heti desszert: ${name}`);
      continue;
    }

    const dayKey = DAY_MAP[kind];
    if (dayKey) {
      const items = body.filter((l) => !/\d[\d.\s]*ft\b/i.test(l));
      if (items.length) {
        days[dayKey] = {
          items,
          price: napiMenuPrice ?? null,
          notes: /napi\s*menü/i.test(section.paren) ? "Napi menü" : "Napi menü",
        };
      }
    }
  }

  if (standingItems.length === 0 && Object.keys(days).length === 0) return null;

  const notesParts = [
    hetiMenuPrice ? `Heti menü: ${hetiMenuPrice}` : null,
    desszertPrice ? `Heti desszert: ${desszertPrice}` : null,
    /\(H-K-SZ-CS-P\)/i.test(cleaned) ? "Mix & match napok: H–K–SZ–CS–P" : null,
  ].filter(Boolean);

  return {
    id: meta.id,
    name: meta.name,
    sourceUrl: meta.sourceUrl,
    weekOf,
    days,
    standing: {
      title: "Heti mix & match (H–P)",
      items: standingItems,
      notes: notesParts.join(". ") || null,
    },
    dailySpecial: null,
    weekBoard: null,
    rawSummary: `Placc heti menü${weekOf ? ` (${weekOf})` : ""}: mix & match + napi specialok.`,
    fetchedAt: meta.fetchedAt,
    parseStatus:
      standingItems.length >= 4 && Object.keys(days).length >= 1
        ? "ok"
        : standingItems.length || Object.keys(days).length
          ? "partial"
          : "failed",
  };
}
