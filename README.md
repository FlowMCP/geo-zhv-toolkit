# geo-zhv-toolkit

Converter + query helpers for the **zHV (Zentrales Haltestellenverzeichnis)** — DELFI's German
central public-transport stop registry. It streams the official zHV XML into a sealed read-only
**SQLite `stops` DB** (DHID + coordinates + AGS) that the FlowMCP `geo` provider consumes as a
local radius source (`sources:'zhv'`), modelled on `geo-gtfs-toolkit` (Memo 116, prospect P1).

The zHV is the canonical stop directory (~287k StopPlaces, ~533k Quays). It carries the **DHID**
(`de:AGS:nr[:area:quay]`) and AGS, but **no EVA number** — the live↔dump bridge needs a separate
EVA↔DHID mapping (Memo 116 P9).

## Data source

zHV via [opendata-oepnv.de](https://www.opendata-oepnv.de/ht/de/datensaetze) — dataset
"Deutschlandweite Haltestellendaten", **CC BY 4.0**, registration required. Download the XML
variant (`zHV_aktuell_xml.*.xml`) and unzip it.

## Build the DB

```bash
npm install
ZHV_XML=/path/to/zHV_aktuell_xml.2026-06-01.xml \
ZHV_DB=$HOME/.flowmcp/data/zhv.db \
node scripts/build-db.mjs
```

Deploy the resulting `zhv.db` to `~/.flowmcp/data/zhv.db` (same convention as `gtfs-de.db`).

## Use in the geo provider

After deploying the DB, query via the canonical `geoNearby` tool:

```
geoNearby { lat, lon, radiusMeters, sources: "zhv" }
```

Wiring (already in `flowmcp-schemas-private`): `sqliteRadius` has a `zhv` adapter
(`~/.flowmcp/data/zhv.db`, table `stops`), `geoNearby` accepts `zhv` as a local source, and
`SOURCE_PRIORITY` ranks it. Features come back lon-first (RFC 7946) with `_source:'zhv'`,
`licence` and `_distanceMeters`.

## Standalone API

```javascript
import Database from 'better-sqlite3'
import { ZhvQuery } from 'geo-zhv-toolkit'

const db = new Database( `${process.env.HOME}/.flowmcp/data/zhv.db`, { readonly: true } )
ZhvQuery.searchByName( { db, query: 'Hauptbahnhof', limit: 10 } )
ZhvQuery.nearbyStops( { db, lat: 52.5256, lon: 13.3695, radiusMeters: 300, limit: 10 } )
```

| Class / method | Purpose |
|----------------|---------|
| `ZhvSqliteConverter.convert({ xmlPath, dbPath, Database })` | stream zHV XML → SQLite `stops` |
| `ZhvQuery.searchByName({ db, query, limit? })` | substring search on `stop_name` |
| `ZhvQuery.nearbyStops({ db, lat, lon, radiusMeters, limit? })` | true-circle radius (metres) |
| `ZhvBridge.matchByPositionAndName({ db, name, lat, lon, radiusMeters?, agsKey?, limit? })` | heuristic EVA→DHID crosswalk (P9) — ranks zHV DHIDs by name similarity + proximity, AGS-boosted |

### EVA ↔ DHID bridge (Memo 116 P9)

There is **no clean key join** between the live world (EVA numbers) and the open data world (DHID):
DB RIS::Stations returns `evaNumber` + `municipalityKey`(AGS) + position but **no DHID/IFOPT**. So
`ZhvBridge` resolves a live station (name + coordinates + optional AGS) to the most plausible zHV
DHID by proximity + normalized-name similarity, boosted when the AGS matches — n:m, every match
carries a `confidence`. Verified live (RIS → zHV): Berlin/Hamburg/München Hbf all resolve at
confidence ≥ 0.97.

```javascript
import { ZhvBridge } from 'geo-zhv-toolkit'
// risStation = { nameLong, position:{latitude,longitude}, municipalityKey } from RIS::Stations
ZhvBridge.matchByPositionAndName( { db, name: 'Berlin Hbf', lat: 52.525592, lon: 13.369545, agsKey: '11000000' } )
// → { best: { dhid: 'de:11000:900003201', confidence: 1, ... }, matches: [...] }
```

## Tests

```bash
npm test   # 8 unit tests (fixture-based)
```

Verified against the official 2026-06-01 release: 820,164 rows (287,254 stops + 532,910 quays).

## License

MIT © FlowMCP
