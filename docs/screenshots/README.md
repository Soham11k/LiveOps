# Screenshots

| File | What it shows |
|------|----------------|
| `ops-alerts.png` | Incident queue (severity, observed vs threshold, state) |
| `ops-replay.png` | Tick replay with teleport scrubber |
| `match-stadium.png` | Arcade half with Mixamo striker |
| `demo.gif.svg` | Storyboard for the reviewer loop until a real `demo.gif` is recorded |

## Capture the demo loop

1. `make seed && make dbt && make api` (other terminal: `make web`)
2. Open `http://localhost:3000/` — incident queue with LIVE pill and pipeline footer
3. Click `speed_hack` — evidence pane shows compiled SQL from `fct_tick_integrity`
4. Ack / resolve to exercise `ops_alert_state`
5. Open Match — WASD, score, watch ticks flush in the footer
6. Open Replay — confirm source label (`silver.match_ticks` or bronze fallback)
7. Record those four beats into `docs/screenshots/demo.gif` and point README at it
