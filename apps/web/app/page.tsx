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
            Night Whiteout pitch — snow, floodlights, crowd, broadcast cams. When momentum is on and you
            trail past 70&apos;, the timing window widens on screen. That is the bug LiveOps must catch.
          </p>
        </section>
        <section className="card">
          <h2>The warehouse</h2>
          <p className="lede">
            dbt owns silver and gold. Airflow + CI run the pipeline. Gold raises alerts and
            two-proportion z-tests. DuckDB locally, or a real Snowflake trial via WAREHOUSE_BACKEND.
          </p>
        </section>
      </div>
    </main>
  );
}
