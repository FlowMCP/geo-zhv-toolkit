# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-07

Initial release (Memo 116, prospect P1).

### Added
- **`ZhvSqliteConverter`** — streams the official zHV XML (Zentrales Haltestellenverzeichnis,
  DELFI; `GetResponseType > Items > StopPlace[]`, ~520 MB) line-by-line into a sealed read-only
  SQLite `stops` table. Native streaming + regex extraction (no external XML library, no full
  in-memory DOM). One row per StopPlace (`kind='stop'`) and per Quay (`kind='quay'`,
  `parent_id`=StopPlace DHID); columns `stop_id`(=DHID), `stop_name`, `stop_lat`, `stop_lon`,
  `kind`, `parent_id`, `municipality_code`(=AGS), `authority`. Coordinate-less rows are skipped,
  not coerced.
- **`ZhvQuery`** — standalone read-only queries: `searchByName` (substring) and `nearbyStops`
  (true-circle bbox + Haversine, metres).
- **`ZhvBridge`** — heuristic EVA↔DHID crosswalk (Memo 116 P9). DB RIS::Stations exposes
  `evaNumber` + `municipalityKey`(AGS) + position but **no DHID/IFOPT**, so there is no clean key
  join; `matchByPositionAndName` ranks zHV DHIDs by normalized-name similarity + proximity, boosted
  on AGS match (n:m, with a confidence). Verified live (RIS→zHV): Berlin/Hamburg/München Hbf
  resolve at confidence ≥ 0.97.
- Table contract matches the FlowMCP geo provider `sqliteRadius` adapter (source `zhv`).
- 8 unit tests (fixture-based) + a verified real-data build: **820,164 rows**
  (287,254 stops + 532,910 quays) from the 2026-06-01 release in ~21 s.

### Notes
- The zHV contains **DHID + coordinates + AGS but NO EVA number** (live↔dump bridge needs a
  separate EVA↔DHID mapping — Memo 116 P9).
- Source: DELFI zHV via opendata-oepnv.de (registration) — CC BY 4.0. Coordinates use a decimal
  POINT in the XML variant (the CSV variant uses a comma).
- Deploy the built DB to `~/.flowmcp/data/zhv.db` for the geo provider (same pattern as
  `gtfs-de.db`); query via `geoNearby` with `sources:'zhv'`.
