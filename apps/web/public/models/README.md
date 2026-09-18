# Optional 3D models for Snowpitch

Metric world: 1 unit = 1 metre. Ball radius ≈ 0.11 m. Player height ≈ 1.8 m.

## Ball (optional)

`make assets` / `scripts/fetch-assets.sh` builds a lightweight procedural `ball.glb`
(or keeps one you drop in). Missing → procedural sphere in `Models.tsx`.

## Stadium / goal shells (optional)

Drop licensed assets at:

- `stadium.glb` — mid-poly bowl shell (metric, pitch at origin)
- `goal.glb` — single goal; mirrored for both ends

Missing → procedural geometry in `Stadium.tsx` (always safe).

## Rigged player — Mixamo (built)

`player.glb` (~2.9 MB) is merged from your soccer FBX pack via:

```bash
make player-glb
# or:
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/merge_mixamo_fbx.py
```

All 22 on-pitch players use `SkeletonUtils.clone` of this GLB with canvas kit maps
(home / away / GK) and squad numbers. Distance LOD falls back to jointed capsules
beyond `lodFar` (see `lib/quality.ts`).

### Source FBX (repo root, gitignored)

Preferred Mixamo “with skin” downloads:

| File | Clip name |
|------|-----------|
| `Idle.fbx` / `Standing Idle.fbx` | Idle |
| `Running.fbx` / `Jogging.fbx` | Running |
| Kick / Pass / Header / Tackle / … | SoccerKick, SoccerPass, … |
| Optional `Celebrate.fbx`, `Goalie Idle.fbx` | Celebrate, GoalieIdle |

If Idle/Running FBX are absent, the merge script aliases Pass→Idle and Tackle→Running.

### Clips in `player.glb`

| Clip | Role |
|------|------|
| `Idle` | Standing / ready |
| `Running` / `Run` / `Jogging` | Locomotion |
| `Kick` / `SoccerKick` / `PenaltyKick` | Shot finish |
| `SoccerPass`, `SoccerHeader`, `SoccerTackle`, … | Extra catalogue |

### Licence

Mixamo: free for personal / portfolio under Adobe terms. Prefer shipping `player.glb`, not the raw FBX pack.
