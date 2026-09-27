# Napi menü

Personal daily lunch-menu aggregator for a handful of Pákozd / Székesfehérvár restaurants. Scrapes public pages (and Facebook) with Playwright, normalizes messy HTML/images into one JSON schema via Gemini Flash (free tier), and serves a static UI on GitHub Pages.

**Live site:** https://balazsbanyai.github.io/pakozdNapiMenu/

## Local setup

```bash
cp .env.example .env   # if needed — you already have GEMINI_APIKEY
npm install
npx playwright install chromium
```

### Scrape

```bash
npm run scrape                              # all restaurants
npm run scrape -- --only banyato,kiskulacs  # subset
```

Writes `docs/data/menus.json`.

### Preview UI

```bash
npm run serve
```

Open http://localhost:4173

Or one-shot: `npm run dev` (scrape then serve).

## Restaurant instructions

Parser behaviour per place lives in `instructions/<id>.md` (e.g. `instructions/placc.md`). These are injected into the Gemini prompt at scrape time — edit the markdown, then re-run `npm run scrape -- --only <id>`.

Placc also has a deterministic text parser (`src/parsers/placc.ts`). If Facebook truncates the post, paste the full text into `inbox/placc.txt`.

| id | Restaurant |
|----|------------|
| `ingoko` | Ingó Kö (Facebook) |
| `beat` | bEAT |
| `banyato` | Bányató |
| `sigma67` | 67 Sigma |
| `pontpizza` | Pont.pizza |
| `kiskulacs` | Kiskulacs |
| `littlebeat` | Little bEAT (clicks EBÉDMENÜ) |
| `placc` | Placc (Facebook) |

## GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Source: **Deploy from a branch** → branch `main` → folder **`/docs`**.
3. Settings → Secrets and variables → Actions → New repository secret → name `GEMINI_APIKEY` (same value as `.env`).
4. Actions → **Update menus** → Run workflow (or wait for the weekday cron).

The Action commits refreshed `docs/data/menus.json` so Pages stays in sync.

## Env

| Variable | Required | Notes |
|----------|----------|--------|
| `GEMINI_APIKEY` | yes | Also accepts `GEMINI_API_KEY` |
| `GEMINI_MODEL` | no | Default `gemini-3.5-flash-lite` |
| `HEADLESS` | no | Set `false` to watch the browser |
| `SCRAPE_GAP_MS` | no | Pause between restaurants (default `4000`) to ease free-tier rate limits |

`.env` is gitignored — never commit the key.
