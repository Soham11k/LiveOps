# Snowpitch

Playable 3D Weekend League plus a Snowflake warehouse that audits whether the live game is fair.

This is not a FIFA clone and not a generic DAU dashboard. You play a short match on a react-three-fiber pitch, open a pack, and trade a card. Those events land next to a simulated league. The LiveOps board then answers the question EA actually gets asked after a patch: **did matchmaking tilt, did pack odds drift, is the market being washed?**

## Why this exists

Snowflake already publishes Player 360 (retention / churn). EA already warehouses telemetry. A student DAU chart is not a unique project.

Snowpitch plants three integrity bugs in a live sports economy, then proves the warehouse can catch them:

1. **Momentum** — after Patch 1.12 Whiteout, teams trailing at 70' score late goals far too often
2. **Pack nerf** — advertised rare rate stays 12%, observed rate drops to ~5.5%
3. **Coin ring** — a cluster of accounts wash-trades discarded cards at 40× median

If the gold tables do not raise those alerts, the project failed.

## Play loop (the 3D game)

A browser match for **FC Rime** on a WebGL pitch (Three.js via `@react-three/fiber`):

- 90 minutes compressed to about a minute
- Chances appear on the pitch; hit **Space** in the green window to shoot
- Result pays a pack
- Optional Blender `.glb` models in `apps/web/public/models/` (ball / player / stadium) — primitives if missing

The game exists to emit real telemetry. Snowflake never sees the 3D layer.

## Warehouse

Default local backend is DuckDB. Set `WAREHOUSE_BACKEND=snowflake` to use a real Snowflake trial. Both backends share the same API and gold mart columns.

```
bronze  raw JSON events (VARIANT on Snowflake)
silver  matches, chances, packs, trades, players
gold    match_fairness, pack_odds, market_health, spend, integrity_alerts
```

## Quick start (DuckDB)

The project lives on a USB volume; keep the Python venv on your Mac disk so macOS AppleDouble files do not break `site.py`.

```bash
python3 -m venv ~/.venvs/snowpitch
~/.venvs/snowpitch/bin/pip install -r requirements.txt
cp .env.example .env   # leave WAREHOUSE_BACKEND=duckdb
make seed
make api               # http://localhost:8000/docs
```

In another terminal:

```bash
cd apps/web && npm install && npm run dev
```

Open http://localhost:3000 — play a 3D match, then open **LiveOps**.

## Snowflake trial

1. Create a free trial at https://signup.snowflake.com
2. Copy `.env.example` → `.env` and fill in account / user / password
3. Set `WAREHOUSE_BACKEND=snowflake`
4. Run:

```bash
make seed-snowflake   # generates events.jsonl + PUT/COPY into Snowflake
make api
```

`warehouse/snowflake_load.py` creates `SNOWPITCH` schemas, stages `data/events.jsonl`, and builds silver/gold. Live match/pack writes `INSERT` into bronze then refresh gold.

## Tests

```bash
make test
```

DuckDB integrity tests always run. A Snowflake smoke test runs only when credentials are present.

## Optional .glb assets

Drop Blender (or CC0) models into `apps/web/public/models/`:

- `ball.glb`
- `player.glb`
- `stadium.glb`

If a file is missing, the scene falls back to capsules / sphere / procedural pitch. Telemetry is identical either way.
