import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import type { FetchResult } from "./fetch.js";
import { parsePlaccMenuText } from "./parsers/placc.js";
import type { RestaurantConfig, RestaurantMenu, Weekday } from "./types.js";
import { WEEKDAYS } from "./types.js";

const EMPTY_DAYS = (): RestaurantMenu["days"] => ({});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS_DIR = path.resolve(__dirname, "..", "instructions");

export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_APIKEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "Missing Gemini API key. Set GEMINI_APIKEY (or GEMINI_API_KEY) in .env",
    );
  }
  return key;
}

export function getGeminiModelName(): string {
  return process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
}

async function loadRestaurantInstructions(id: string): Promise<string | null> {
  const file = path.join(INSTRUCTIONS_DIR, `${id}.md`);
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    return null;
  }
}

async function buildPrompt(config: RestaurantConfig, todayIso: string): Promise<string> {
  const fileInstructions = await loadRestaurantInstructions(config.id);
  const restaurantBlock = [
    fileInstructions
      ? `Restaurant-specific instructions (follow closely):\n${fileInstructions}`
      : null,
    config.notesForModel ? `Extra fetcher notes: ${config.notesForModel}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return `You extract Hungarian restaurant lunch / weekly menus into strict JSON.

Restaurant: ${config.name}
Source URL: ${config.url}
Today (ISO date): ${todayIso}

${restaurantBlock || "No restaurant-specific instructions on file."}

Global rules:
- Output ONLY a single JSON object (no markdown fences, no commentary).
- Use English keys exactly as specified.
- Weekday keys must be: monday, tuesday, wednesday, thursday, friday, saturday, sunday.
- Dish names stay in Hungarian as published.
- If the menu is a single weekly board not assigned to days, put dishes in weekBoard and leave days as {}.
- If there is a mix-and-match / standing offering, use standing.
- If there is a separate single daily special (not already mapped into days), use dailySpecial.
- If information is missing, use null / [] — do not invent dishes.
- Prefer the most recent weekly lunch menu. If today is Saturday/Sunday (or the new week is not posted yet), keep the latest Mon–Fri board even if that date range just ended.
- Ignore navigation, impressum, opening hours unless they are part of the menu price notes.
- Never put the actual dishes only into rawSummary — always fill days / weekBoard / standing / dailySpecial when dishes are visible.
- rawSummary is a short human blurb only (1–3 sentences).
- parseStatus should be "ok" when you extracted a usable menu, "partial" if something important is missing, "failed" only if no dishes could be found.
- Restaurant-specific instructions override these globals when they conflict.

JSON schema:
{
  "weekOf": string | null,
  "days": {
    "<weekday>": { "items": string[], "price": string | null, "notes": string | null }
  },
  "standing": { "title": string | null, "items": string[], "notes": string | null } | null,
  "dailySpecial": { "title": string | null, "items": string[], "price": string | null, "notes": string | null } | null,
  "weekBoard": { "items": string[], "price": string | null, "notes": string | null } | null,
  "rawSummary": string | null,
  "parseStatus": "ok" | "partial" | "failed"
}`;
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function normalizeDay(value: unknown): RestaurantMenu["days"][Weekday] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const items = Array.isArray(v.items)
    ? v.items.map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  if (items.length === 0 && !v.price && !v.notes) return undefined;
  return {
    items,
    price: v.price == null ? null : String(v.price),
    notes: v.notes == null ? null : String(v.notes),
  };
}

function coerceMenu(
  config: RestaurantConfig,
  parsed: Record<string, unknown>,
  fetchedAt: string,
): RestaurantMenu {
  const days: RestaurantMenu["days"] = EMPTY_DAYS();
  const rawDays = (parsed.days && typeof parsed.days === "object"
    ? (parsed.days as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  for (const day of WEEKDAYS) {
    const normalized = normalizeDay(rawDays[day]);
    if (normalized) days[day] = normalized;
  }

  // Accept Hungarian day names if the model slips
  const huMap: Record<string, Weekday> = {
    hétfő: "monday",
    hetfo: "monday",
    kedd: "tuesday",
    szerda: "wednesday",
    csütörtök: "thursday",
    csutortok: "thursday",
    péntek: "friday",
    pentek: "friday",
    szombat: "saturday",
    vasárnap: "sunday",
    vasarnap: "sunday",
  };
  for (const [key, value] of Object.entries(rawDays)) {
    const mapped = huMap[key.toLowerCase()];
    if (mapped && !days[mapped]) {
      const normalized = normalizeDay(value);
      if (normalized) days[mapped] = normalized;
    }
  }

  const standing =
    parsed.standing && typeof parsed.standing === "object"
      ? {
          title:
            (parsed.standing as { title?: unknown }).title == null
              ? null
              : String((parsed.standing as { title?: unknown }).title),
          items: Array.isArray((parsed.standing as { items?: unknown }).items)
            ? ((parsed.standing as { items: unknown[] }).items).map(String)
            : [],
          notes:
            (parsed.standing as { notes?: unknown }).notes == null
              ? null
              : String((parsed.standing as { notes?: unknown }).notes),
        }
      : null;

  const dailySpecial =
    parsed.dailySpecial && typeof parsed.dailySpecial === "object"
      ? {
          title:
            (parsed.dailySpecial as { title?: unknown }).title == null
              ? null
              : String((parsed.dailySpecial as { title?: unknown }).title),
          items: Array.isArray((parsed.dailySpecial as { items?: unknown }).items)
            ? ((parsed.dailySpecial as { items: unknown[] }).items).map(String)
            : [],
          price:
            (parsed.dailySpecial as { price?: unknown }).price == null
              ? null
              : String((parsed.dailySpecial as { price?: unknown }).price),
          notes:
            (parsed.dailySpecial as { notes?: unknown }).notes == null
              ? null
              : String((parsed.dailySpecial as { notes?: unknown }).notes),
        }
      : null;

  const weekBoard =
    parsed.weekBoard && typeof parsed.weekBoard === "object"
      ? {
          items: Array.isArray((parsed.weekBoard as { items?: unknown }).items)
            ? ((parsed.weekBoard as { items: unknown[] }).items).map(String)
            : [],
          price:
            (parsed.weekBoard as { price?: unknown }).price == null
              ? null
              : String((parsed.weekBoard as { price?: unknown }).price),
          notes:
            (parsed.weekBoard as { notes?: unknown }).notes == null
              ? null
              : String((parsed.weekBoard as { notes?: unknown }).notes),
        }
      : null;

  const status = parsed.parseStatus;
  let parseStatus: RestaurantMenu["parseStatus"] =
    status === "ok" || status === "partial" || status === "failed" ? status : "partial";

  const hasAny =
    Object.values(days).some((d) => d?.items?.length) ||
    (standing?.items?.length ?? 0) > 0 ||
    (dailySpecial?.items?.length ?? 0) > 0 ||
    (weekBoard?.items?.length ?? 0) > 0;

  if (parseStatus === "failed" && hasAny) parseStatus = "partial";
  if (parseStatus === "ok" && !hasAny) parseStatus = "partial";

  return {
    id: config.id,
    name: config.name,
    sourceUrl: config.url,
    weekOf: parsed.weekOf == null ? null : String(parsed.weekOf),
    days,
    standing,
    dailySpecial,
    weekBoard,
    rawSummary: parsed.rawSummary == null ? null : String(parsed.rawSummary),
    fetchedAt,
    parseStatus,
  };
}

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") || "";
    if (!ctype.includes("image") && !url.match(/\.(png|jpe?g|webp|gif)(\?|$)/i)) {
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 5_000 || buf.length > 8_000_000) return null;
    return buf;
  } catch {
    return null;
  }
}

function mimeFor(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  return "image/png";
}

export async function parseWithGemini(
  config: RestaurantConfig,
  fetchResult: FetchResult,
): Promise<RestaurantMenu> {
  const fetchedAt = new Date().toISOString();

  // Placc: prefer deterministic text parser when the Facebook post is complete enough
  if (config.id === "placc" && fetchResult.text) {
    const local = parsePlaccMenuText(fetchResult.text, {
      id: config.id,
      name: config.name,
      sourceUrl: config.url,
      fetchedAt,
    });
    if (local && (local.standing?.items.length || Object.keys(local.days).length)) {
      // If still thin (truncated FB "Továbbiak"), fall through to Gemini with instructions
      const richEnough =
        (local.standing?.items.length ?? 0) >= 6 ||
        Object.keys(local.days).length >= 2;
      if (richEnough) {
        console.log("(deterministic placc parser)");
        return local;
      }
    }
  }

  const modelName = getGeminiModelName();
  const genAI = new GoogleGenerativeAI(getGeminiApiKey());
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const parts: Part[] = [
    { text: await buildPrompt(config, new Date().toISOString().slice(0, 10)) },
  ];

  if (fetchResult.text?.trim()) {
    parts.push({
      text: `\nExtracted page / post text:\n"""\n${fetchResult.text.slice(0, 35_000)}\n"""\n`,
    });
  }

  for (const shot of fetchResult.screenshots.slice(0, 2)) {
    parts.push({
      inlineData: {
        mimeType: mimeFor(shot),
        data: shot.toString("base64"),
      },
    });
  }

  // Extra linked images for photo menus (Facebook especially)
  const extraImages = fetchResult.screenshots.length ? 4 : 6;
  let added = 0;
  for (const url of fetchResult.imageUrls) {
    if (added >= extraImages) break;
    const buf = await downloadImage(url);
    if (!buf) continue;
    parts.push({
      inlineData: {
        mimeType: mimeFor(buf),
        data: buf.toString("base64"),
      },
    });
    added += 1;
  }

  try {
    const result = await generateWithRetry(model, parts);
    const text = result.response.text();
    const json = JSON.parse(stripFences(text)) as Record<string, unknown>;
    return coerceMenu(config, json, fetchedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: config.id,
      name: config.name,
      sourceUrl: config.url,
      weekOf: null,
      days: {},
      standing: null,
      dailySpecial: null,
      weekBoard: null,
      rawSummary: null,
      fetchedAt,
      parseStatus: "failed",
      error: message,
    };
  }
}

async function generateWithRetry(
  model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>,
  parts: Part[],
  attempts = 4,
) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await model.generateContent({ contents: [{ role: "user", parts }] });
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryMatch = msg.match(/retry in ([0-9.]+)s/i);
      const isRetryable = /429|Too Many Requests|quota|503|high demand|unavailable/i.test(msg);
      if (!isRetryable || i === attempts - 1) throw err;
      const waitSec = retryMatch ? Number(retryMatch[1]) : 20 * (i + 1);
      const waitMs = Math.min(Math.ceil(waitSec * 1000) + 500, 90_000);
      console.log(`(rate limited, waiting ${Math.round(waitMs / 1000)}s)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}
