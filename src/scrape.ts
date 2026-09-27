import "dotenv/config";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRestaurant, withBrowser } from "./fetch.js";
import { getGeminiModelName, parseWithGemini } from "./gemini.js";
import { applyInboxOverride } from "./inbox.js";
import { RESTAURANTS } from "./restaurants.js";
import type { MenusFile, RestaurantMenu } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(ROOT, "docs", "data", "menus.json");

function parseArgs(argv: string[]): { only: string[] } {
  const only: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only" || a === "-o") {
      const value = argv[++i];
      if (!value) throw new Error("--only requires a comma-separated restaurant id list");
      only.push(...value.split(",").map((s) => s.trim()).filter(Boolean));
    } else if (a.startsWith("--only=")) {
      only.push(...a.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean));
    }
  }
  return { only };
}

async function loadPrevious(): Promise<MenusFile | null> {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    return JSON.parse(raw) as MenusFile;
  } catch {
    return null;
  }
}

function menuHasDishes(menu: RestaurantMenu): boolean {
  if (Object.values(menu.days || {}).some((d) => d?.items?.length)) return true;
  if (menu.weekBoard?.items?.length) return true;
  if (menu.standing?.items?.length) return true;
  if (menu.dailySpecial?.items?.length) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const { only } = parseArgs(process.argv.slice(2));
  const selected = only.length
    ? RESTAURANTS.filter((r) => only.includes(r.id))
    : RESTAURANTS;

  if (only.length && selected.length === 0) {
    console.error(
      `No restaurants matched. Known ids: ${RESTAURANTS.map((r) => r.id).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`Scraping ${selected.length} restaurant(s): ${selected.map((r) => r.id).join(", ")}`);
  console.log(`Model: ${getGeminiModelName()}`);

  const previous = await loadPrevious();
  const previousById = new Map(previous?.restaurants.map((r) => [r.id, r]) ?? []);

  const results: RestaurantMenu[] = [];
  const gapMs = Number(process.env.SCRAPE_GAP_MS || 4000);

  await withBrowser(async (browser) => {
    for (let i = 0; i < selected.length; i++) {
      const config = selected[i];
      process.stdout.write(`→ ${config.name} (${config.mode})… `);
      try {
        const fetched = await applyInboxOverride(
          config.id,
          await fetchRestaurant(browser, config),
        );
        const textLen = fetched.text?.length ?? 0;
        const shots = fetched.screenshots.length;
        process.stdout.write(
          `fetched text=${textLen} shots=${shots} imgs=${fetched.imageUrls.length}; parsing… `,
        );
        let menu = await parseWithGemini(config, fetched);
        const prev = previousById.get(config.id);
        if (!menuHasDishes(menu) && prev && menuHasDishes(prev)) {
          console.log(
            `${menu.parseStatus} (kept previous good data; new error: ${menu.error ?? menu.parseStatus})`,
          );
          menu = {
            ...prev,
            fetchedAt: menu.fetchedAt,
            error: menu.error
              ? `Refresh failed, showing cached menu. ${menu.error}`
              : "Refresh returned empty; showing cached menu.",
          };
        } else {
          console.log(menu.parseStatus + (menu.error ? ` (${menu.error})` : ""));
        }
        results.push(menu);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`FAILED: ${message}`);
        const prev = previousById.get(config.id);
        if (prev && menuHasDishes(prev)) {
          results.push({
            ...prev,
            error: `Refresh failed, showing cached menu. ${message}`,
          });
        } else {
          results.push({
            id: config.id,
            name: config.name,
            sourceUrl: config.url,
            weekOf: null,
            days: {},
            standing: null,
            dailySpecial: null,
            weekBoard: null,
            rawSummary: null,
            fetchedAt: new Date().toISOString(),
            parseStatus: "failed",
            error: message,
          });
        }
      }
      if (i < selected.length - 1 && gapMs > 0) await sleep(gapMs);
    }
  });

  let restaurants: RestaurantMenu[];
  if (only.length) {
    const updated = new Map(previousById);
    for (const r of results) updated.set(r.id, r);
    restaurants = RESTAURANTS.map((c) => updated.get(c.id)).filter(Boolean) as RestaurantMenu[];
    if (restaurants.length === 0) restaurants = results;
  } else {
    restaurants = results;
  }

  const payload: MenusFile = {
    generatedAt: new Date().toISOString(),
    model: getGeminiModelName(),
    restaurants,
  };

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
