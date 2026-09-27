# Placc Étterem — parser instructions

Facebook lunch posts are plain text with a fixed section structure. Prefer the latest post that starts with **Heti menü** and a date range. Ignore decorative symbols if present — match on the **words and layout**.

## Structure

1. **Header:** `Heti menü (MM.DD.-MM.DD.)` → `weekOf`.

2. **Mix & match courses** (same options every weekday in the range):
   - Section title is a course name, then days in parentheses, e.g.  
     `Levesek (H-K-SZ-CS-P):` / `Főételek (H-K-SZ-CS-P)`
   - Course name = text before `(` (Levesek, Főételek, …).
   - Day letters in parentheses:
     - H = hétfő, K = kedd, SZ = szerda, CS = csütörtök, P = péntek
   - Following lines until the next section title are the dish options.
   - Put **all** of these into `standing` (not `days`).
   - Prefix items with the course: `Leves: …`, `Főétel: …`.
   - `standing.title`: e.g. `Heti mix & match (H–P)`.

3. **Daily specials:**
   - Section title is a weekday + `(napi menü)`, e.g. `Kedd (napi menü):`
   - → `days.<weekday>` with `notes: "Napi menü"`.
   - Do **not** copy mix-and-match dishes into `days`.

4. **Weekly dessert:**
   - `Heti desszert: <name>` → add to `standing.items` as `Heti desszert: <name>`.

5. **Prices** (usually at the bottom):
   - `Heti menü: … Ft` → `standing.notes`
   - `Napi menü: … Ft` → each napi day's `price`
   - `Heti desszert: … Ft` → `standing.notes`

## Mapping

| Section                         | JSON field                         |
|---------------------------------|------------------------------------|
| Levesek / Főételek lists        | `standing.items`                   |
| Heti desszert                   | `standing.items` (+ notes)         |
| `<Weekday> (napi menü)`         | `days.monday` … `days.friday`      |
| Price lines                     | `standing.notes` + day `price`     |

Leave `weekBoard` and top-level `dailySpecial` **null** (napi menük go in `days`).

## Example

```
Heti menü (09.21.-09.25.)
Levesek (H-K-SZ-CS-P):
Húsleves eperlevél tésztával
Zöldbableves
Főételek (H-K-SZ-CS-P)
Milánói sertésborda
Dubarry csirkemell pirított burgonyával
Kedd (napi menü):
Kolbászos burgonyaleves
Töltött káposzta tejföllel
Heti desszert: Mákos guba vanília öntettel
Heti menü: 3200 Ft
Napi menü: 3350 Ft
Heti desszert: 650 Ft
```

```json
{
  "weekOf": "09.21.-09.25.",
  "standing": {
    "title": "Heti mix & match (H–P)",
    "items": [
      "Leves: Húsleves eperlevél tésztával",
      "Leves: Zöldbableves",
      "Főétel: Milánói sertésborda",
      "Főétel: Dubarry csirkemell pirított burgonyával",
      "Heti desszert: Mákos guba vanília öntettel"
    ],
    "notes": "Heti menü: 3200 Ft. Heti desszert: 650 Ft."
  },
  "days": {
    "tuesday": {
      "items": ["Kolbászos burgonyaleves", "Töltött káposzta tejföllel"],
      "price": "3350 Ft",
      "notes": "Napi menü"
    }
  },
  "dailySpecial": null,
  "weekBoard": null,
  "parseStatus": "ok"
}
```

## Fetch notes

The scraper finds the menu post’s `/posts/…` permalink on the page feed, then opens that URL directly (full text, no feed truncation). If that fails, paste the post into `inbox/placc.txt`.

When full text is available, `src/parsers/placc.ts` runs first (no Gemini). This file is the Gemini fallback.
