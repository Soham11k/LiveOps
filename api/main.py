from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from simulator.config import ADVERTISED_RARE_RATE, PATCH_TS, POST_PATCH_RARE_RATE
from simulator.generate import FIRST, LAST, NATIONS, event, uid
from warehouse import get_warehouse

RNG = random.Random()

app = FastAPI(title="Snowpitch", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def wh():
    warehouse = get_warehouse()
    if not warehouse.ready():
        raise HTTPException(
            503,
            "Warehouse is empty. Run `make seed` (DuckDB) or `make seed-snowflake` first.",
        )
    return warehouse


class BootstrapIn(BaseModel):
    display_name: Optional[str] = None


class ChanceIn(BaseModel):
    minute: int
    timing: float
    scored: bool
    trailing_before: bool
    late: bool
    attacking_home: bool = True


class MatchIn(BaseModel):
    player_id: str
    home_goals: int
    away_goals: int
    chances: List[ChanceIn] = Field(default_factory=list)
    opponent_id: Optional[str] = None
    opponent_ovr: int = 78


class PackIn(BaseModel):
    player_id: str


class BuyIn(BaseModel):
    player_id: str
    listing_id: str


class ConfigIn(BaseModel):
    momentum: Optional[bool] = None
    pack_nerf: Optional[bool] = None


class TickIn(BaseModel):
    tick_ms: int
    minute: float
    ball_x: float
    ball_y: float
    ball_z: float
    possession: str
    home_goals: int
    away_goals: int
    phase: str
    momentum_on: bool = True
    chrome_assist: bool = False
    world_scale: float = 1.0


class TicksBatchIn(BaseModel):
    match_id: str
    player_id: Optional[str] = None
    patch: Optional[str] = "1.12-whiteout"
    ticks: List[TickIn] = Field(default_factory=list)


def now() -> datetime:
    return datetime.now(timezone.utc)


@app.get("/health")
def health() -> dict:
    warehouse = get_warehouse()
    return {
        "ok": warehouse.ready(),
        "backend": warehouse.backend_name(),
    }


@app.get("/ops/pipeline")
def pipeline() -> dict:
    return wh().pipeline()


@app.post("/me/bootstrap")
def bootstrap(body: BootstrapIn) -> dict:
    warehouse = wh()
    player_id = uid("you")
    name = body.display_name or f"{RNG.choice(FIRST)} {RNG.choice(LAST)}"
    squad = [
        {
            "pos": pos,
            "name": f"{RNG.choice(FIRST)} {RNG.choice(LAST)}",
            "ovr": ovr,
            "nation": RNG.choice(NATIONS),
        }
        for pos, ovr in [
            ("GK", 76),
            ("LB", 77),
            ("CB", 79),
            ("CB", 78),
            ("RB", 76),
            ("CM", 80),
            ("CM", 81),
            ("LW", 82),
            ("ST", 84),
            ("ST", 83),
            ("RW", 81),
        ]
    ]
    ovr = round(sum(p["ovr"] for p in squad) / len(squad))
    ts = now()
    warehouse.ingest_events(
        [
            event(
                "player_snapshot",
                ts,
                player_id,
                {
                    "display_name": name,
                    "nation": RNG.choice(NATIONS),
                    "ovr": ovr,
                    "spend_tier": "f2p",
                    "lifetime_spend": 0,
                    "bot": False,
                    "squad": squad,
                    "coins": 7500,
                },
            )
        ]
    )
    return {
        "player_id": player_id,
        "display_name": name,
        "ovr": ovr,
        "coins": 7500,
        "squad": squad,
    }


@app.get("/me/{player_id}")
def me(player_id: str) -> dict:
    row = wh().me(player_id)
    if not row:
        raise HTTPException(404, "Unknown player")
    return row


@app.get("/play/opponent")
def opponent() -> dict:
    row = wh().opponent()
    if not row:
        raise HTTPException(503, "Seed the warehouse first")
    return row


@app.get("/ops/config")
def get_config() -> dict:
    return wh().get_config()


@app.post("/ops/config")
def set_config(body: ConfigIn) -> dict:
    return wh().set_config(momentum=body.momentum, pack_nerf=body.pack_nerf)


@app.post("/play/match")
def play_match(body: MatchIn) -> dict:
    warehouse = wh()
    ts = now()
    match_id = uid("m")
    cfg = warehouse.get_config()
    patch = "1.12-whiteout" if ts >= PATCH_TS else "1.11"
    opp = body.opponent_id or "bot_live"
    rows = [
        event(
            "match_start",
            ts,
            body.player_id,
            {
                "match_id": match_id,
                "home_id": body.player_id,
                "away_id": opp,
                "home_ovr": 80,
                "away_ovr": body.opponent_ovr,
                "home_spend_tier": "f2p",
                "away_spend_tier": "f2p",
                "patch": patch,
                "mode": "weekend_league",
                "live": True,
                "momentum_on": cfg.get("momentum", True),
            },
        )
    ]
    for ch in body.chances:
        chance_id = uid("ch")
        ch_ts = ts.replace(microsecond=0)
        rows.append(
            event(
                "chance",
                ch_ts,
                body.player_id if ch.attacking_home else opp,
                {
                    "match_id": match_id,
                    "chance_id": chance_id,
                    "minute": ch.minute,
                    "attacking_home": ch.attacking_home,
                    "trailing_before": ch.trailing_before,
                    "late": ch.late,
                    "timing": ch.timing,
                    "patch": patch,
                    "live": True,
                },
            )
        )
        if ch.scored:
            rows.append(
                event(
                    "goal",
                    ch_ts,
                    body.player_id if ch.attacking_home else opp,
                    {
                        "match_id": match_id,
                        "chance_id": chance_id,
                        "minute": ch.minute,
                        "late": ch.late,
                        "trailing_before": ch.trailing_before,
                        "patch": patch,
                        "live": True,
                    },
                )
            )
    winner = None
    if body.home_goals > body.away_goals:
        winner = body.player_id
    elif body.away_goals > body.home_goals:
        winner = opp
    rows.append(
        event(
            "match_end",
            ts,
            body.player_id,
            {
                "match_id": match_id,
                "home_id": body.player_id,
                "away_id": opp,
                "home_goals": body.home_goals,
                "away_goals": body.away_goals,
                "home_spend_tier": "f2p",
                "away_spend_tier": "f2p",
                "home_ovr": 80,
                "away_ovr": body.opponent_ovr,
                "winner_id": winner,
                "patch": patch,
                "mode": "weekend_league",
                "live": True,
            },
        )
    )
    warehouse.ingest_events(rows)
    return {"match_id": match_id, "reward_pack": True, "winner_id": winner}


@app.post("/play/pack")
def open_pack(body: PackIn) -> dict:
    warehouse = wh()
    ts = now()
    cfg = warehouse.get_config()
    patch = "1.12-whiteout"
    rate = POST_PATCH_RARE_RATE if cfg.get("pack_nerf", True) else ADVERTISED_RARE_RATE
    is_rare = RNG.random() < rate
    rarity = "rare" if is_rare else RNG.choice(["common", "uncommon"])
    ovr = int(RNG.randint(84, 93) if is_rare else RNG.randint(70, 82))
    name = f"{RNG.choice(FIRST)} {RNG.choice(LAST)}"
    pack_id = uid("pk")
    warehouse.ingest_events(
        [
            event(
                "pack_open",
                ts,
                body.player_id,
                {
                    "pack_id": pack_id,
                    "pack_type": "whiteout_rare",
                    "advertised_rare_rate": ADVERTISED_RARE_RATE,
                    "observed_rare": is_rare,
                    "rarity": rarity,
                    "ovr": ovr,
                    "name": name,
                    "patch": patch,
                    "live": True,
                },
            )
        ]
    )
    return {
        "pack_id": pack_id,
        "rarity": rarity,
        "ovr": ovr,
        "name": name,
        "advertised_rare_rate": ADVERTISED_RARE_RATE,
        "is_rare": is_rare,
    }


@app.get("/market/listings")
def listings() -> list[dict]:
    rows = wh().listings(12)
    live = []
    for r in rows:
        live.append(
            {
                "listing_id": r["listing_id"],
                "name": f"{RNG.choice(FIRST)} {RNG.choice(LAST)}",
                "rarity": r["rarity"],
                "price": int(r["price"]),
                "ovr": 72 if r["rarity"] == "common" else 80 if r["rarity"] == "uncommon" else 87,
            }
        )
    return live[:8]


@app.post("/market/buy")
def buy(body: BuyIn) -> dict:
    warehouse = wh()
    ts = now()
    listings_rows = listings()
    item = next((x for x in listings_rows if x["listing_id"] == body.listing_id), None)
    if not item:
        raise HTTPException(404, "Listing gone")
    warehouse.ingest_events(
        [
            event(
                "market_sale",
                ts,
                body.player_id,
                {
                    "trade_id": uid("tr"),
                    "seller_id": "market",
                    "buyer_id": body.player_id,
                    "card_id": body.listing_id,
                    "rarity": item["rarity"],
                    "price": item["price"],
                    "median_ref": 850,
                    "seconds_listed": 400,
                    "wash": False,
                    "patch": "1.12-whiteout",
                    "live": True,
                    "name": item["name"],
                    "ovr": item["ovr"],
                },
            )
        ]
    )
    return {"ok": True, "card": item}


@app.get("/ops/summary")
def summary() -> dict:
    return wh().summary()


@app.get("/ops/fairness")
def fairness() -> list[dict]:
    return wh().fairness()


@app.get("/ops/packs")
def packs() -> list[dict]:
    return wh().packs()


@app.get("/ops/market")
def market() -> list[dict]:
    return wh().market()


@app.get("/ops/alerts")
def alerts() -> list[dict]:
    return wh().alerts()


class AlertStateIn(BaseModel):
    state: str
    actor: Optional[str] = "ops"
    note: Optional[str] = ""


@app.post("/ops/alerts/{alert_id}/state")
def set_alert_state(alert_id: str, body: AlertStateIn) -> dict:
    try:
        return wh().set_alert_state(
            alert_id,
            body.state,
            actor=body.actor or "ops",
            note=body.note or "",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/ops/alerts/{alert_id}/evidence")
def alert_evidence(alert_id: str) -> dict:
    return wh().alert_evidence(alert_id)


@app.get("/ops/daily")
def daily() -> list[dict]:
    return wh().daily()


@app.get("/ops/spend")
def spend() -> list[dict]:
    return wh().spend()


@app.get("/ops/quality")
def quality() -> dict:
    return wh().quality()


@app.get("/ops/integrity-tests")
def integrity_tests() -> list[dict]:
    return wh().integrity_tests()


@app.post("/play/ticks")
def ingest_ticks(body: TicksBatchIn) -> dict:
    """Fire-and-forget batch of 10 Hz match ticks from the live client."""
    if not body.match_id or not body.ticks:
        return {"ok": True, "n": 0}
    rows = [t.model_dump() if hasattr(t, "model_dump") else t.dict() for t in body.ticks]
    n = wh().ingest_ticks(
        body.match_id,
        rows,
        player_id=body.player_id or "",
        patch=body.patch or "1.12-whiteout",
    )
    return {"ok": True, "n": n}


@app.get("/ops/replay/{match_id}")
def replay(match_id: str) -> dict:
    return wh().replay(match_id)


@app.get("/ops/flagged-matches")
def flagged_matches(limit: int = 20) -> list[dict]:
    return wh().flagged_matches(limit=limit)


@app.post("/ops/refresh")
def refresh_marts() -> dict:
    wh().refresh_marts()
    return {"ok": True, "backend": wh().backend_name()}
