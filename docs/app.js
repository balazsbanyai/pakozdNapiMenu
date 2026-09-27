const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

const WEEKDAY_HU = {
  monday: "Hétfő",
  tuesday: "Kedd",
  wednesday: "Szerda",
  thursday: "Csütörtök",
  friday: "Péntek",
};

/** Mon–Fri only; weekend falls back to Friday (last lunch day). */
function todayKey(date = new Date()) {
  const idx = (date.getDay() + 6) % 7; // Mon=0 … Sun=6
  return WEEKDAYS[Math.min(idx, 4)];
}

function formatStamp(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("hu-HU", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday 00:00 of the ISO-ish week containing `date` (Mon–Sun). */
function mondayOf(date) {
  const d = startOfDay(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatWeekRange(start, end) {
  return `${isoDate(start)} - ${isoDate(end)}`;
}

/**
 * Parse messy weekOf strings into {start,end} local dates when possible.
 * Examples: "09.21.-09.25.", "2026-09-21 - 2026-09-25", "2026. szept. 28 – okt. 2."
 */
function parseWeekOf(raw, fallbackYear) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  const year = fallbackYear || new Date().getFullYear();

  // 2026-09-21 – 2026-09-25 or 2026-09-21
  let m = s.match(
    /(\d{4})-(\d{2})-(\d{2})(?:\s*[–—-]\s*(\d{4})-(\d{2})-(\d{2}))?/,
  );
  if (m) {
    const start = new Date(+m[1], +m[2] - 1, +m[3]);
    const end = m[4] ? new Date(+m[4], +m[5] - 1, +m[6]) : addDays(start, 4);
    return { start, end };
  }

  // 09.21.-09.25. (month.day – month.day)
  m = s.match(/(\d{1,2})\.(\d{1,2})\.?\s*[–—-]\s*(\d{1,2})\.(\d{1,2})\.?/);
  if (m) {
    const startMonth = +m[1];
    const startDay = +m[2];
    const endMonth = +m[3];
    const endDay = +m[4];
    const start = new Date(year, startMonth - 1, startDay);
    const endYear = endMonth < startMonth ? year + 1 : year;
    const end = new Date(endYear, endMonth - 1, endDay);
    return { start, end };
  }

  return null;
}

function weekRangeFromData(data) {
  const anchor = data.generatedAt ? new Date(data.generatedAt) : new Date();
  const year = anchor.getFullYear();
  const ranges = (data.restaurants || [])
    .map((r) => parseWeekOf(r.weekOf, year))
    .filter(Boolean);

  if (ranges.length) {
    // Prefer the most common Monday (ms) among parsed ranges
    const counts = new Map();
    for (const r of ranges) {
      const key = mondayOf(r.start).getTime();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let bestKey = mondayOf(anchor).getTime();
    let bestCount = -1;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }
    const start = new Date(bestKey);
    const end = addDays(start, 4); // Fri
    return { start, end };
  }

  const start = mondayOf(anchor);
  return { start, end: addDays(start, 4) };
}

function hasContent(restaurant, day) {
  const d = restaurant.days?.[day];
  if (d?.items?.length) return true;
  if (restaurant.weekBoard?.items?.length) return true;
  if (restaurant.standing?.items?.length) return true;
  if (restaurant.dailySpecial?.items?.length) return true;
  return false;
}

function listHtml(items) {
  if (!items?.length) return "";
  return `<ul class="dish-list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderRestaurant(r, day) {
  const dayMenu = r.days?.[day];
  const parts = [];

  if (dayMenu?.items?.length) {
    if (dayMenu.price) parts.push(`<p class="price">${escapeHtml(dayMenu.price)}</p>`);
    parts.push(listHtml(dayMenu.items));
    if (dayMenu.notes) parts.push(`<p class="notes">${escapeHtml(dayMenu.notes)}</p>`);
  }

  if (r.weekBoard?.items?.length) {
    parts.push(`<p class="block-title">Heti tábla</p>`);
    if (r.weekBoard.price) parts.push(`<p class="price">${escapeHtml(r.weekBoard.price)}</p>`);
    parts.push(listHtml(r.weekBoard.items));
    if (r.weekBoard.notes) parts.push(`<p class="notes">${escapeHtml(r.weekBoard.notes)}</p>`);
  }

  if (r.standing?.items?.length) {
    parts.push(
      `<p class="block-title">${escapeHtml(r.standing.title || "Állandó / mix & match")}</p>`,
    );
    parts.push(listHtml(r.standing.items));
    if (r.standing.notes) parts.push(`<p class="notes">${escapeHtml(r.standing.notes)}</p>`);
  }

  if (r.dailySpecial?.items?.length) {
    parts.push(
      `<p class="block-title">${escapeHtml(r.dailySpecial.title || "Napi special")}</p>`,
    );
    if (r.dailySpecial.price) {
      parts.push(`<p class="price">${escapeHtml(r.dailySpecial.price)}</p>`);
    }
    parts.push(listHtml(r.dailySpecial.items));
    if (r.dailySpecial.notes) {
      parts.push(`<p class="notes">${escapeHtml(r.dailySpecial.notes)}</p>`);
    }
  }

  if (!parts.length) {
    if (r.parseStatus === "failed") {
      parts.push(
        `<p class="error">Nem sikerült beolvasni${r.error ? `: ${escapeHtml(r.error)}` : "."}</p>`,
      );
    } else {
      parts.push(`<p class="empty">Nincs megjeleníthető menü erre a napra.</p>`);
    }
  }

  const badge =
    r.parseStatus === "failed"
      ? `<span class="badge bad">hiba</span>`
      : r.parseStatus === "partial"
        ? `<span class="badge">részleges</span>`
        : "";

  return `
    <article class="card">
      <div class="card-head">
        <div class="card-head__left">
          <h2>${escapeHtml(r.name)}</h2>
          ${badge}
        </div>
        <a class="source" href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener">
          Forrás
          <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
        </a>
      </div>
      ${parts.join("\n")}
    </article>
  `;
}

function render(data, selectedDay) {
  const nav = document.getElementById("day-nav");
  const menus = document.getElementById("menus");
  const title = document.getElementById("day-title");
  const meta = document.getElementById("meta");
  const weekEl = document.getElementById("week-range");

  const isToday = selectedDay === todayKey() && new Date().getDay() >= 1 && new Date().getDay() <= 5;
  title.textContent = isToday ? "Mai ebédek" : `${WEEKDAY_HU[selectedDay]}i menük`;

  const range = weekRangeFromData(data);
  weekEl.hidden = false;
  weekEl.textContent = formatWeekRange(range.start, range.end);

  meta.textContent = data.generatedAt
    ? `Összeállítva: ${formatStamp(data.generatedAt)}${data.model ? ` · ${data.model}` : ""}`
    : "Még nincs adat — futtasd: npm run scrape";

  nav.innerHTML = WEEKDAYS.map((day) => {
    const pressed = day === selectedDay;
    return `<button type="button" class="chip" data-day="${day}" aria-pressed="${pressed}">
      <span class="material-symbols-outlined chip__check" aria-hidden="true">check</span>
      ${WEEKDAY_HU[day]}
    </button>`;
  }).join("");

  nav.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = btn.getAttribute("data-day");
      history.replaceState(null, "", `?day=${day}`);
      render(data, day);
    });
  });

  const restaurants = data.restaurants || [];
  if (!restaurants.length) {
    menus.innerHTML = `<p class="empty">Nincs menü az adatfájlban.</p>`;
    return;
  }

  const ordered = [...restaurants].sort((a, b) => {
    const ac = hasContent(a, selectedDay) ? 0 : 1;
    const bc = hasContent(b, selectedDay) ? 0 : 1;
    return ac - bc || a.name.localeCompare(b.name, "hu");
  });

  menus.innerHTML = ordered.map((r) => renderRestaurant(r, selectedDay)).join("");
}

async function main() {
  const params = new URLSearchParams(location.search);
  let day = params.get("day");
  if (!WEEKDAYS.includes(day)) day = todayKey();

  try {
    const res = await fetch(`./data/menus.json?ts=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data, day);
  } catch (err) {
    document.getElementById("meta").textContent =
      `Nem sikerült betölteni a menus.json-t (${err.message})`;
  }
}

main();
