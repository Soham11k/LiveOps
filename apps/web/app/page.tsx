import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <p className="kicker">Weekend League · Patch 1.12 Whiteout</p>
      <h1>Play the match. Audit the league.</h1>
      <p className="lede">
        Snowpitch is a small winter football game wired to a Snowflake-shaped warehouse.
        You take chances in a compressed 90 minutes, open a pack, and trade a card. The
        LiveOps board then has to catch three planted integrity bugs: late-game momentum,
        advertised pack odds that drifted, and a coin-wash ring on the transfer market.
      </p>
      <div style={{ display: "flex", gap: 12, margin: "28px 0 40px" }}>
        <Link className="btn" href="/play">
          Kick off
        </Link>
        <Link className="btn ghost" href="/ops">
          Open LiveOps
        </Link>
      </div>
      <div className="row">
        <section className="card">
          <h2>The 3D game</h2>
          <p className="lede">
            FC Rime on a react-three-fiber pitch. When a chance opens, hit Space in the green window
            to shoot — or to tackle if they are attacking. Optional Blender .glb models; primitives if missing.
          </p>
        </section>
        <section className="card">
          <h2>The warehouse</h2>
          <p className="lede">
            Bronze JSON events, silver matches/packs/trades, gold fairness and alerts.
            DuckDB locally, or a real Snowflake trial via WAREHOUSE_BACKEND=snowflake.
          </p>
        </section>
      </div>
    </main>
  );
}
