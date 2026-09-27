import "dotenv/config";
import { chromium, type Page, type Browser } from "playwright";
import type { RestaurantConfig } from "./types.js";

export interface FetchResult {
  restaurantId: string;
  url: string;
  text?: string;
  screenshots: Buffer[];
  imageUrls: string[];
}

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function headless(): boolean {
  const v = process.env.HEADLESS;
  if (v === "false" || v === "0") return false;
  return true;
}

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: headless() });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    userAgent: DEFAULT_UA,
    locale: "hu-HU",
    viewport: { width: 1280, height: 1800 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  return page;
}

async function goto(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);
}

async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const sel of ["script", "style", "noscript", "svg", "iframe"]) {
      clone.querySelectorAll(sel).forEach((n) => n.remove());
    }
    return (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  });
}

async function collectImageUrls(page: Page, limit = 12): Promise<string[]> {
  const urls = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img")] as HTMLImageElement[];
    return imgs
      .map((img) => img.currentSrc || img.src)
      .filter((src) => src && /^https?:/i.test(src) && !src.includes("data:"));
  });
  // Prefer larger / menu-like images by keeping unique absolute URLs
  return [...new Set(urls)].slice(0, limit);
}

async function screenshotMain(page: Page): Promise<Buffer> {
  // JPEG + capped full-page keeps Gemini payloads under free-tier limits
  try {
    return await page.screenshot({
      fullPage: true,
      type: "jpeg",
      quality: 55,
    });
  } catch {
    return page.screenshot({ type: "jpeg", quality: 55 });
  }
}

async function dismissCookieBanners(page: Page): Promise<void> {
  const patterns = [
    /elfogadom/i,
    /összes elfogadása/i,
    /accept all/i,
    /accept/i,
    /allow all/i,
    /consent/i,
    /^ok$/i,
  ];
  for (const pattern of patterns) {
    const candidates = [
      page.getByRole("button", { name: pattern }),
      page.getByRole("link", { name: pattern }),
      page.locator("a, button, input[type=button], input[type=submit]").filter({ hasText: pattern }),
    ];
    for (const locator of candidates) {
      if (!(await locator.count())) continue;
      try {
        await locator.first().click({ timeout: 2000 });
        await page.waitForTimeout(800);
        return;
      } catch {
        /* try next */
      }
    }
  }
}

/** Prefer menu-ish main text; drop obvious legal / cookie boilerplate dumps. */
async function menuishText(page: Page): Promise<string> {
  const text = await visibleText(page);
  const lower = text.toLowerCase();
  const looksLikeLegal =
    lower.includes("adatvédelmi") &&
    lower.includes("sütikre vonatkozó") &&
    !lower.includes("heti men");
  if (!looksLikeLegal) return text;

  // Try common content containers after cookie interstitial
  const nested = await page.evaluate(() => {
    const sels = ["main", "#content", ".content", "article", "#main"];
    for (const sel of sels) {
      const el = document.querySelector(sel) as HTMLElement | null;
      const t = el?.innerText?.trim() || "";
      if (t.length > 200) return t;
    }
    return "";
  });
  return nested || text;
}

async function fetchPageText(browser: Browser, config: RestaurantConfig): Promise<FetchResult> {
  const page = await newPage(browser);
  try {
    await goto(page, config.url);
    await dismissCookieBanners(page);
    // Some sites bounce to a legal interstitial; re-open the menu URL after accept
    if (page.url() !== config.url) {
      await goto(page, config.url);
      await dismissCookieBanners(page);
    }
    let text = await menuishText(page);
    if (/adatvédelmi/i.test(text) && !/heti\s*men/i.test(text)) {
      await goto(page, config.url);
      await page.waitForTimeout(1500);
      text = await menuishText(page);
    }
    const imageUrls = await collectImageUrls(page);
    // If text still looks empty of menu, also grab a screenshot for the model
    const screenshots: Buffer[] = [];
    if (!/menü|leves|ebéd|heti/i.test(text)) {
      screenshots.push(await screenshotMain(page));
    }
    return {
      restaurantId: config.id,
      url: config.url,
      text: text.slice(0, 40_000),
      screenshots,
      imageUrls,
    };
  } finally {
    await page.context().close();
  }
}

async function fetchPageScreenshot(
  browser: Browser,
  config: RestaurantConfig,
): Promise<FetchResult> {
  const page = await newPage(browser);
  try {
    await goto(page, config.url);
    await dismissCookieBanners(page);
    await page.waitForTimeout(2000);
    const text = await menuishText(page);
    const shot = await screenshotMain(page);
    const imageUrls = await collectImageUrls(page);
    return {
      restaurantId: config.id,
      url: config.url,
      text: text.slice(0, 20_000),
      screenshots: [shot],
      imageUrls,
    };
  } finally {
    await page.context().close();
  }
}

async function fetchClickThenScreenshot(
  browser: Browser,
  config: RestaurantConfig,
): Promise<FetchResult> {
  const page = await newPage(browser);
  try {
    await goto(page, config.url);
    await dismissCookieBanners(page);
    const clickText = config.clickText ?? "EBÉDMENÜ";
    const candidates = [
      page.getByRole("button", { name: new RegExp(clickText, "i") }),
      page.getByRole("link", { name: new RegExp(clickText, "i") }),
      page.getByText(new RegExp(clickText, "i")),
    ];
    let clicked = false;
    for (const locator of candidates) {
      if (await locator.count()) {
        try {
          await locator.first().click({ timeout: 5000 });
          clicked = true;
          await page.waitForTimeout(2500);
          break;
        } catch {
          /* try next */
        }
      }
    }
    const text = await menuishText(page);
    const shot = await screenshotMain(page);
    const imageUrls = await collectImageUrls(page);
    return {
      restaurantId: config.id,
      url: config.url,
      text: `${clicked ? `[Clicked: ${clickText}]\n` : `[WARN: could not click ${clickText}]\n`}${text}`.slice(
        0,
        20_000,
      ),
      screenshots: [shot],
      imageUrls,
    };
  } finally {
    await page.context().close();
  }
}

async function dismissFacebookChrome(page: Page): Promise<void> {
  await dismissCookieBanners(page);
  for (const label of [
    "Close",
    "Not Now",
    "Allow all cookies",
    "Decline optional cookies",
    "Allow essential and optional cookies",
    "Only allow essential cookies",
    "Az összes cookie engedélyezése",
    "A nem kötelező cookie-k elutasítása",
  ]) {
    const btn = page.getByRole("button", { name: new RegExp(label, "i") });
    if (await btn.count()) {
      try {
        await btn.first().click({ timeout: 2000 });
      } catch {
        /* ignore */
      }
    }
  }
}

/** Strip FB tracking junk from a post permalink. */
function cleanFacebookPostUrl(href: string): string {
  try {
    const u = new URL(href);
    // Keep only path (+ essential query for permalink.php / story.php)
    if (/\/posts\//i.test(u.pathname) || /\/reel\//i.test(u.pathname)) {
      return `${u.origin}${u.pathname}`;
    }
    if (/permalink\.php|story\.php/i.test(u.pathname)) {
      const keep = new URLSearchParams();
      for (const key of ["story_fbid", "id", "fbid"]) {
        const v = u.searchParams.get(key);
        if (v) keep.set(key, v);
      }
      const q = keep.toString();
      return `${u.origin}${u.pathname}${q ? `?${q}` : ""}`;
    }
    return href.split("#")[0]!;
  } catch {
    return href;
  }
}

/**
 * Pass 1: on the page feed, find the permalink of the latest menu-ish post.
 * Timestamp links ("6 n.", "2 d.") usually point at /posts/pfbid… without truncation.
 */
async function findFacebookMenuPostUrl(page: Page, pageUrl: string): Promise<string | null> {
  await goto(page, pageUrl);
  await dismissFacebookChrome(page);
  await page.waitForTimeout(2000);
  await page.mouse.wheel(0, 1800);
  await page.waitForTimeout(1000);

  const found = await page.evaluate(() => {
    type Cand = { href: string; score: number };
    const cands: Cand[] = [];

    // Prefer anchors inside a container that mentions heti/napi menü
    for (const el of document.querySelectorAll("div, article, section") as NodeListOf<HTMLElement>) {
      const t = el.innerText || "";
      if (t.length < 20 || t.length > 4000) continue;
      if (!/heti\s*menü|napi\s*menü|ebédmenü|heti\s*ebéd/i.test(t)) continue;
      for (const a of el.querySelectorAll("a[href]") as NodeListOf<HTMLAnchorElement>) {
        const href = a.href || "";
        if (!/\/posts\/|permalink\.php|story\.php|story_fbid=/i.test(href)) continue;
        if (/login|recover|password/i.test(href)) continue;
        let score = 10;
        if (/heti\s*menü/i.test(t)) score += 5;
        if (/\/posts\//i.test(href)) score += 3;
        cands.push({ href, score });
      }
    }

    // Fallback: any /posts/ link on the page (newest often first)
    if (!cands.length) {
      for (const a of document.querySelectorAll("a[href]") as NodeListOf<HTMLAnchorElement>) {
        const href = a.href || "";
        if (!/\/posts\/|permalink\.php|story\.php|story_fbid=/i.test(href)) continue;
        if (/login|recover|password/i.test(href)) continue;
        cands.push({ href, score: 1 });
      }
    }

    cands.sort((a, b) => b.score - a.score);
    return cands[0]?.href ?? null;
  });

  return found ? cleanFacebookPostUrl(found) : null;
}

async function extractFacebookMenuText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const body = document.body.innerText || "";
    const idx = body.search(/heti\s*menü|napi\s*menü|levesek\s*\(/i);
    if (idx >= 0) {
      // Cut before login wall chrome when possible
      let slice = body.slice(idx, idx + 12_000);
      const cut = slice.search(
        /\n\s*(Az összes reakció|Tetszik\n|E-mail cím vagy telefonszám|Elfelejtetted a jelszavadat)/i,
      );
      if (cut > 80) slice = slice.slice(0, cut);
      return slice.trim();
    }
    return body.slice(0, 12_000);
  });
}

async function fetchFacebook(browser: Browser, config: RestaurantConfig): Promise<FetchResult> {
  const page = await newPage(browser);
  try {
    // Pass 1 — discover post permalink from the page feed
    const postUrl = await findFacebookMenuPostUrl(page, config.url);
    const targetUrl = postUrl || config.url;
    if (postUrl) {
      console.log(`(facebook post ${postUrl})`);
    } else {
      console.log("(facebook: no post permalink found, using page feed)");
    }

    // Pass 2 — open the post directly (full text, no "Továbbiak")
    await goto(page, targetUrl);
    await dismissFacebookChrome(page);
    await page.waitForTimeout(1500);

    const text = await extractFacebookMenuText(page);
    const shot = await screenshotMain(page);
    const imageUrls = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll("img")] as HTMLImageElement[];
      return imgs
        .map((img) => ({
          src: img.currentSrc || img.src,
          w: img.naturalWidth || img.width,
          h: img.naturalHeight || img.height,
        }))
        .filter((i) => i.src.startsWith("http") && i.w >= 180 && i.h >= 180)
        .sort((a, b) => b.w * b.h - a.w * a.h)
        .map((i) => i.src);
    });

    return {
      restaurantId: config.id,
      url: targetUrl,
      text: text.slice(0, 30_000),
      screenshots: [shot],
      imageUrls: [...new Set(imageUrls)].slice(0, 10),
    };
  } finally {
    await page.context().close();
  }
}

export async function fetchRestaurant(
  browser: Browser,
  config: RestaurantConfig,
): Promise<FetchResult> {
  switch (config.mode) {
    case "page-text":
      return fetchPageText(browser, config);
    case "page-screenshot":
      return fetchPageScreenshot(browser, config);
    case "click-then-screenshot":
      return fetchClickThenScreenshot(browser, config);
    case "facebook":
      return fetchFacebook(browser, config);
    default:
      throw new Error(`Unknown mode: ${(config as RestaurantConfig).mode}`);
  }
}
