import type { RestaurantConfig } from "./types.js";

/**
 * Fetch strategy only. Parser behaviour lives in `instructions/<id>.md`
 * (loaded into the Gemini prompt at scrape time).
 */
export const RESTAURANTS: RestaurantConfig[] = [
  {
    id: "ingoko",
    name: "Ingó Kö Étterem",
    url: "https://www.facebook.com/ingoko.etterem",
    mode: "facebook",
  },
  {
    id: "beat",
    name: "bEAT",
    url: "https://beat.hu/heti-menu/",
    mode: "page-screenshot",
  },
  {
    id: "banyato",
    name: "Bányató Vendéglő",
    url: "https://banyatovendeglo.hu/heti-menu",
    mode: "page-text",
  },
  {
    id: "sigma67",
    name: "67 Sigma",
    url: "https://67sigma.hu/heti-ebedmenu/",
    mode: "page-text",
  },
  {
    id: "pontpizza",
    name: "Pont.pizza",
    url: "https://pontpizza.hu/heti-menu/",
    mode: "page-screenshot",
  },
  {
    id: "kiskulacs",
    name: "Kiskulacs Vendéglő",
    url: "https://www.kiskulacs.hu/hetimenu",
    mode: "page-text",
  },
  {
    id: "littlebeat",
    name: "Little bEAT",
    url: "https://littlebeat.hu/",
    mode: "click-then-screenshot",
    clickText: "EBÉDMENÜ",
  },
  {
    id: "placc",
    name: "Placc Étterem",
    url: "https://www.facebook.com/placcetterem/",
    mode: "facebook",
  },
];
