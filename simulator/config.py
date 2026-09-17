from datetime import datetime, timezone

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
DB_PATH = "data/snowpitch.duckdb"
