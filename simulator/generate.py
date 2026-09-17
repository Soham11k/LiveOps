from __future__ import annotations

import argparse
import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from simulator.config import (
    ADVERTISED_RARE_RATE,
    COIN_RING_SIZE,
    EVENTS_PARQUET_DIR,
    EVENTS_PATH,
    POST_PATCH_RARE_RATE,
    SEED,
    resolve_scale,
)

FIRST = [
    "Soren", "Mira", "Kael", "Anja", "Rolf", "Ilya", "Noor", "Petra",
    "Leif", "Yara", "Oskar", "Hana", "Nils", "Asha", "Bram", "Elsa",
]
LAST = [
    "Voss", "Rime", "Kade", "Holt", "Isk", "Berg", "Sable", "Frost",
    "Quinn", "Dahl", "Kerr", "Lumen", "Ash", "Vale", "Norr", "Skye",
]
NATIONS = ["NOR", "SWE", "FIN", "CAN", "SCO", "ISL", "GER", "JPN"]


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def event(event_type: str, ts: datetime, player_id: str, payload: dict) -> dict:
    return {
        "event_id": uid("evt"),
        "event_type": event_type,
        "ts": iso(ts),
        "player_id": player_id,
        "payload": payload,
    }


def build_players(rng: random.Random, n_players: int) -> list[dict]:
    players = []
    for i in range(n_players):
        roll = rng.random()
        if roll < 0.08:
            tier = "whale"
        elif roll < 0.38:
            tier = "casual"
        else:
            tier = "f2p"
        ovr = int(rng.gauss(78, 6))
        ovr = max(62, min(94, ovr))
        players.append(
            {
                "player_id": f"bot_{i:04d}",
                "display_name": f"{rng.choice(FIRST)} {rng.choice(LAST)}",
                "nation": rng.choice(NATIONS),
                "ovr": ovr,
                "spend_tier": tier,
                "lifetime_spend": {
                    "f2p": 0.0,
                    "casual": round(rng.uniform(8, 60), 2),
                    "whale": round(rng.uniform(120, 900), 2),
                }[tier],
            }
        )
    return players


def match_outcome(
    rng: random.Random, home: dict, away: dict, ts: datetime, patch_ts: datetime
) -> dict:
    gap = (home["ovr"] - away["ovr"]) / 12.0
    home_p = 1 / (1 + pow(10, -gap))
    patched = ts >= patch_ts

    home_goals = 0
    away_goals = 0
    chances = []
    minute = 8
    while minute < 92:
        minute += rng.randint(8, 16)
        if minute > 90:
            break
        attacking_home = rng.random() < home_p
        attacker = home if attacking_home else away
        trailing = (
            (attacking_home and home_goals < away_goals)
            or ((not attacking_home) and away_goals < home_goals)
        )
        finish = 0.22 + (attacker["ovr"] - 75) * 0.008
        if patched and trailing and minute >= 70:
            finish *= 2.15
        finish = min(0.72, finish)
        scored = rng.random() < finish
        if scored:
            if attacking_home:
                home_goals += 1
            else:
                away_goals += 1
        chances.append(
            {
                "minute": min(90, minute),
                "attacker_id": attacker["player_id"],
                "attacking_home": attacking_home,
                "scored": scored,
                "trailing_before": trailing,
                "late": minute >= 70,
            }
        )

    return {
        "home_goals": home_goals,
        "away_goals": away_goals,
        "chances": chances,
        "patched": patched,
    }


def _flush_parquet(rows: list[dict], out_dir: Path, chunk_idx: int) -> int:
    import pyarrow as pa
    import pyarrow.parquet as pq

    if not rows:
        return chunk_idx
    table = pa.Table.from_pylist(
        [
            {
                "event_id": r["event_id"],
                "event_type": r["event_type"],
                "ts": r["ts"],
                "player_id": r["player_id"],
                "payload": json.dumps(r["payload"]),
            }
            for r in rows
        ]
    )
    path = out_dir / f"events_{chunk_idx:05d}.parquet"
    pq.write_table(table, path, compression="zstd")
    return chunk_idx + 1


def generate_season(scale: str = "demo", path: Path | None = None) -> tuple[Path, int]:
    profile = resolve_scale(scale)
    rng = random.Random(SEED)
    players = build_players(rng, profile["n_players"])
    ring = [p["player_id"] for p in players[:COIN_RING_SIZE]]
    season_start = profile["season_start"]
    season_end = profile["season_end"]
    patch_ts = profile["patch_ts"]
    matches_per_day = profile["matches_per_day"]
    days = (season_end - season_start).days

    fmt = profile["format"]
    total = 0
    chunk_idx = 0
    buffer: list[dict] = []
    chunk_size = 50_000

    parquet_dir = Path(EVENTS_PARQUET_DIR)
    jsonl_path = Path(path or EVENTS_PATH)

    if fmt == "parquet":
        if parquet_dir.exists():
            for old in parquet_dir.glob("*.parquet"):
                old.unlink()
        parquet_dir.mkdir(parents=True, exist_ok=True)
    else:
        jsonl_path.parent.mkdir(parents=True, exist_ok=True)

    def emit(row: dict) -> None:
        nonlocal total, chunk_idx, buffer
        buffer.append(row)
        total += 1
        if fmt == "parquet" and len(buffer) >= chunk_size:
            chunk_idx = _flush_parquet(buffer, parquet_dir, chunk_idx)
            buffer = []

    for p in players:
        emit(
            event(
                "player_snapshot",
                season_start,
                p["player_id"],
                {
                    "display_name": p["display_name"],
                    "nation": p["nation"],
                    "ovr": p["ovr"],
                    "spend_tier": p["spend_tier"],
                    "lifetime_spend": p["lifetime_spend"],
                    "bot": True,
                },
            )
        )

    for d in range(days):
        day = season_start + timedelta(days=d)
        for _ in range(matches_per_day):
            home, away = rng.sample(players, 2)
            kickoff = day + timedelta(
                hours=rng.randint(10, 22),
                minutes=rng.randint(0, 59),
                seconds=rng.randint(0, 59),
            )
            match_id = uid("m")
            result = match_outcome(rng, home, away, kickoff, patch_ts)
            patch = "1.12-whiteout" if kickoff >= patch_ts else "1.11"

            emit(
                event(
                    "match_start",
                    kickoff,
                    home["player_id"],
                    {
                        "match_id": match_id,
                        "home_id": home["player_id"],
                        "away_id": away["player_id"],
                        "home_ovr": home["ovr"],
                        "away_ovr": away["ovr"],
                        "home_spend_tier": home["spend_tier"],
                        "away_spend_tier": away["spend_tier"],
                        "patch": patch,
                        "mode": "weekend_league",
                    },
                )
            )
            for chance in result["chances"]:
                ts = kickoff + timedelta(seconds=chance["minute"] * 40)
                chance_id = uid("ch")
                emit(
                    event(
                        "chance",
                        ts,
                        chance["attacker_id"],
                        {
                            "match_id": match_id,
                            "chance_id": chance_id,
                            "minute": chance["minute"],
                            "attacking_home": chance["attacking_home"],
                            "trailing_before": chance["trailing_before"],
                            "late": chance["late"],
                            "timing": round(rng.uniform(0.2, 0.95), 3),
                            "patch": patch,
                        },
                    )
                )
                if chance["scored"]:
                    emit(
                        event(
                            "goal",
                            ts + timedelta(seconds=2),
                            chance["attacker_id"],
                            {
                                "match_id": match_id,
                                "chance_id": chance_id,
                                "minute": chance["minute"],
                                "late": chance["late"],
                                "trailing_before": chance["trailing_before"],
                                "patch": patch,
                            },
                        )
                    )

            end_ts = kickoff + timedelta(minutes=12)
            home_win = result["home_goals"] > result["away_goals"]
            draw = result["home_goals"] == result["away_goals"]
            emit(
                event(
                    "match_end",
                    end_ts,
                    home["player_id"],
                    {
                        "match_id": match_id,
                        "home_id": home["player_id"],
                        "away_id": away["player_id"],
                        "home_goals": result["home_goals"],
                        "away_goals": result["away_goals"],
                        "home_spend_tier": home["spend_tier"],
                        "away_spend_tier": away["spend_tier"],
                        "home_ovr": home["ovr"],
                        "away_ovr": away["ovr"],
                        "winner_id": None
                        if draw
                        else (home["player_id"] if home_win else away["player_id"]),
                        "patch": patch,
                        "mode": "weekend_league",
                    },
                )
            )

            opener = home if rng.random() < 0.55 else away
            if rng.random() < 0.42:
                rare_rate = (
                    POST_PATCH_RARE_RATE if kickoff >= patch_ts else ADVERTISED_RARE_RATE
                )
                is_rare = rng.random() < rare_rate
                rarity = "rare" if is_rare else rng.choice(["common", "common", "uncommon"])
                emit(
                    event(
                        "pack_open",
                        end_ts + timedelta(seconds=30),
                        opener["player_id"],
                        {
                            "pack_id": uid("pk"),
                            "pack_type": "whiteout_rare",
                            "advertised_rare_rate": ADVERTISED_RARE_RATE,
                            "observed_rare": is_rare,
                            "rarity": rarity,
                            "ovr": int(rng.randint(82, 93) if is_rare else rng.randint(68, 81)),
                            "patch": patch,
                        },
                    )
                )

        for _ in range(profile["honest_trades_per_day"]):
            seller, buyer = rng.sample(players, 2)
            price = max(150, int(rng.gauss(850, 220)))
            trade_ts = day + timedelta(hours=rng.randint(11, 23), minutes=rng.randint(0, 59))
            emit(
                event(
                    "market_sale",
                    trade_ts,
                    seller["player_id"],
                    {
                        "trade_id": uid("tr"),
                        "seller_id": seller["player_id"],
                        "buyer_id": buyer["player_id"],
                        "card_id": uid("cd"),
                        "rarity": rng.choice(["common", "uncommon", "rare"]),
                        "price": price,
                        "median_ref": 850,
                        "seconds_listed": rng.randint(400, 18000),
                        "wash": False,
                        "patch": "1.12-whiteout" if trade_ts >= patch_ts else "1.11",
                    },
                )
            )

        if day >= patch_ts:
            for _ in range(profile["wash_trades_per_day"]):
                seller_id, buyer_id = rng.sample(ring, 2)
                trade_ts = day + timedelta(hours=rng.randint(2, 5), minutes=rng.randint(0, 12))
                emit(
                    event(
                        "market_sale",
                        trade_ts,
                        seller_id,
                        {
                            "trade_id": uid("tr"),
                            "seller_id": seller_id,
                            "buyer_id": buyer_id,
                            "card_id": uid("cd"),
                            "rarity": "common",
                            "price": rng.randint(7800, 12400),
                            "median_ref": 850,
                            "seconds_listed": rng.randint(8, 95),
                            "wash": True,
                            "patch": "1.12-whiteout",
                        },
                    )
                )

        if d % 10 == 0 and fmt == "parquet":
            print(f"  day {d}/{days} — {total:,} events so far")

    if fmt == "parquet":
        chunk_idx = _flush_parquet(buffer, parquet_dir, chunk_idx)
        meta = {
            "scale": scale,
            "events": total,
            "chunks": chunk_idx,
            "season_start": iso(season_start),
            "season_end": iso(season_end),
            "patch_ts": iso(patch_ts),
        }
        (parquet_dir / "manifest.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return parquet_dir, total

    buffer.sort(key=lambda r: r["ts"])
    with jsonl_path.open("w", encoding="utf-8") as f:
        for row in buffer:
            f.write(json.dumps(row) + "\n")
    return jsonl_path, total


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Generate Snowpitch season telemetry")
    parser.add_argument(
        "--scale",
        default="demo",
        choices=["demo", "large"],
        help="demo (~64k JSONL) or large (~5M Parquet chunks)",
    )
    parser.add_argument(
        "--skip-warehouse",
        action="store_true",
        help="Only write events; do not rebuild DuckDB / run dbt",
    )
    args = parser.parse_args(argv)

    path, n = generate_season(scale=args.scale)
    print(f"Wrote {n:,} events -> {path} (scale={args.scale})")

    if args.skip_warehouse:
        return

    from warehouse.duckdb_backend import rebuild

    if args.scale == "large":
        # Large profile lands as Parquet; load_bronze handles the glob.
        from warehouse.dbt_runner import run as dbt_run
        from warehouse.duckdb_backend import load_bronze_parquet

        db = load_bronze_parquet(path)
        dbt_run("build", target="duckdb")
        print(f"Warehouse -> {db}")
    else:
        db = rebuild(EVENTS_PATH)
        print(f"Warehouse -> {db}")


if __name__ == "__main__":
    main()
