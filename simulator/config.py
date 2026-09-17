from datetime import datetime, timedelta, timezone

SEED = 17
SEASON_START = datetime(2026, 3, 1, tzinfo=timezone.utc)
SEASON_END = datetime(2026, 3, 15, tzinfo=timezone.utc)
PATCH_TS = datetime(2026, 3, 8, tzinfo=timezone.utc)
N_PLAYERS = 720
MATCHES_PER_DAY = 420
ADVERTISED_RARE_RATE = 0.12
POST_PATCH_RARE_RATE = 0.055
COIN_RING_SIZE = 8
DATA_DIR = "data"
EVENTS_PATH = "data/events.jsonl"
EVENTS_PARQUET_DIR = "data/events_parquet"
DB_PATH = "data/snowpitch.duckdb"

# Named scale profiles. `demo` keeps `make test` fast; `large` is the
# portfolio-scale run (~5M events across a 90-day season).
SCALE_PROFILES = {
    "demo": {
        "n_players": 720,
        "matches_per_day": 420,
        "season_days": 14,
        "honest_trades_per_day": 90,
        "wash_trades_per_day": 28,
        "format": "jsonl",
    },
    "large": {
        "n_players": 2400,
        "matches_per_day": 4000,
        "season_days": 90,
        "honest_trades_per_day": 400,
        "wash_trades_per_day": 80,
        "format": "parquet",
    },
}


def resolve_scale(name: str = "demo") -> dict:
    if name not in SCALE_PROFILES:
        raise ValueError(f"Unknown scale '{name}'. Choose from {list(SCALE_PROFILES)}")
    profile = dict(SCALE_PROFILES[name])
    profile["name"] = name
    profile["season_start"] = SEASON_START
    profile["season_end"] = SEASON_START + timedelta(days=profile["season_days"])
    # Patch lands at the midpoint of the season so both baselines exist.
    profile["patch_ts"] = SEASON_START + timedelta(days=profile["season_days"] // 2)
    return profile
