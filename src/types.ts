export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const WEEKDAYS: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const WEEKDAY_HU: Record<Weekday, string> = {
  monday: "Hétfő",
  tuesday: "Kedd",
  wednesday: "Szerda",
  thursday: "Csütörtök",
  friday: "Péntek",
  saturday: "Szombat",
  sunday: "Vasárnap",
};

export interface DayMenu {
  /** Free-form dishes / courses for that day */
  items: string[];
  /** Overall price if stated (e.g. "3100 Ft") */
  price?: string | null;
  notes?: string | null;
}

export interface RestaurantMenu {
  id: string;
  name: string;
  sourceUrl: string;
  weekOf?: string | null;
  /** Per-day lunch menus when the restaurant publishes by weekday */
  days: Partial<Record<Weekday, DayMenu>>;
  /** Permanent / mix-and-match offerings (e.g. Placc) */
  standing?: {
    title?: string | null;
    items: string[];
    notes?: string | null;
  } | null;
  /** Extra daily special when separate from the weekly board */
  dailySpecial?: {
    title?: string | null;
    items: string[];
    price?: string | null;
    notes?: string | null;
  } | null;
  /** Whole-week board that isn't split by day (show every day) */
  weekBoard?: {
    items: string[];
    price?: string | null;
    notes?: string | null;
  } | null;
  rawSummary?: string | null;
  fetchedAt: string;
  parseStatus: "ok" | "partial" | "failed";
  error?: string | null;
}

export interface MenusFile {
  generatedAt: string;
  model: string;
  restaurants: RestaurantMenu[];
}

export type FetchMode =
  | "page-text"
  | "page-screenshot"
  | "click-then-screenshot"
  | "facebook";

export interface RestaurantConfig {
  id: string;
  name: string;
  url: string;
  mode: FetchMode;
  /** CSS / text used for click-then-screenshot */
  clickText?: string;
  /**
   * Optional short inline hint. Prefer `instructions/<id>.md` in the repo —
   * that file is loaded automatically and appended to the Gemini prompt.
   */
  notesForModel?: string;
}
