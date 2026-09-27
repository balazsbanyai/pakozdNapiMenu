# Kiskulacs Vendéglő — parser instructions

HTML table: weekday rows with **LEVES / A menü / B menü**.

- Fill `days` with combined items per weekday (label A/B if helpful).
- Daily add-ons below the table (állandó opciók) → `standing`.
- Capture menü ár into `price` / `notes`.
- Dismiss cookie / legal interstitial content — only parse the actual heti menü.
