"""
Merge Mixamo soccer FBX files into a single player.glb with named clips.

Usage (from repo root):
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/merge_mixamo_fbx.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "web" / "public" / "models" / "player.glb"

# Prefer files that typically include skin + useful clips for our state machine.
# Clip names must match Players.tsx substring matching (idle/run/kick/pass/header…).
CLIP_SOURCES = [
    # Prefer locomotion when present (drop Idle.fbx / Running.fbx at repo root)
    ("Idle.fbx", "Idle"),
    ("Idle (1).fbx", "IdleAlt"),
    ("Standing Idle.fbx", "Idle"),
    ("Running.fbx", "Running"),
    ("Running (1).fbx", "RunningAlt"),
    ("Jogging.fbx", "Jogging"),
    ("Walk.fbx", "Walk"),
    ("Kick Soccerball.fbx", "SoccerKick"),
    ("Kick Soccerball (1).fbx", "SoccerKickAlt"),
    ("Soccer Penalty Kick.fbx", "PenaltyKick"),
    ("Soccer Pass.fbx", "SoccerPass"),
    ("Soccer Pass (1).fbx", "SoccerPassAlt"),
    ("Soccer Header.fbx", "SoccerHeader"),
    ("Header Soccerball.fbx", "HeaderBall"),
    ("Kneeing Soccerball.fbx", "Kneeing"),
    ("Soccer Tackle.fbx", "SoccerTackle"),
    ("Soccer Tackle (1).fbx", "SoccerTackleAlt"),
    ("Soccer Tackle (2).fbx", "SoccerTackleAlt2"),
    ("Soccer Trip.fbx", "SoccerTrip"),
    ("Celebrate.fbx", "Celebrate"),
    ("Goalie Idle.fbx", "GoalieIdle"),
]


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path: Path) -> None:
    bpy.ops.import_scene.fbx(
        filepath=str(path),
        automatic_bone_orientation=True,
        use_anim=True,
        ignore_leaf_bones=True,
    )


def find_armature():
    for obj in bpy.context.scene.objects:
        if obj.type == "ARMATURE":
            return obj
    return None


def collect_and_rename_actions(clip_name: str, before: set) -> None:
    """Rename newly imported actions to clip_name (and clip_name_N for extras)."""
    after = set(bpy.data.actions.keys())
    new_names = sorted(after - before)
    if not new_names:
        # Sometimes Mixamo sticks the action on the armature without new Action datablock name churn;
        # fall back to the last action that isn't already one of ours.
        for act in bpy.data.actions:
            if not act.name.startswith(("Soccer", "Penalty", "Header", "Kneeing")):
                act.name = clip_name
                return
        return
    for i, name in enumerate(new_names):
        act = bpy.data.actions[name]
        act.name = clip_name if i == 0 else f"{clip_name}_{i}"
        # Keep NLA/track friendly
        act.use_fake_user = True


def purge_orphans() -> None:
    # Keep meshes + armature from first import; strip duplicate meshes from later imports.
    pass


def main() -> int:
    existing = [(ROOT / name, clip) for name, clip in CLIP_SOURCES if (ROOT / name).exists()]
    if not existing:
        print("No Mixamo FBX files found in repo root.", file=sys.stderr)
        return 1

    reset_scene()
    primary_path, primary_clip = existing[0]
    print(f"Primary mesh+skin: {primary_path.name} -> {primary_clip}")
    before = set(bpy.data.actions.keys())
    import_fbx(primary_path)
    collect_and_rename_actions(primary_clip, before)

    arm = find_armature()
    if arm is None:
        print("No armature found in primary FBX.", file=sys.stderr)
        return 1

    # Subsequent imports: take actions only, delete duplicate meshes/armatures.
    for path, clip in existing[1:]:
        print(f"Animation: {path.name} -> {clip}")
        before_objs = set(bpy.data.objects.keys())
        before_acts = set(bpy.data.actions.keys())
        import_fbx(path)
        collect_and_rename_actions(clip, before_acts)

        # Remove newly added objects (duplicate characters); keep actions.
        after_objs = set(bpy.data.objects.keys())
        for name in after_objs - before_objs:
            obj = bpy.data.objects.get(name)
            if obj is None:
                continue
            bpy.data.objects.remove(obj, do_unlink=True)

    # Drop Mixamo prop meshes (soccer ball icospheres) — we render our own ball.
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        name = obj.name.lower()
        print(f"  mesh present: {obj.name}")
        if "beta_surface" in name or "beta_joints" in name:
            continue
        # Anything that isn't the Mixamo body mesh is a prop.
        if "beta" not in name:
            print(f"  removing prop mesh: {obj.name}")
            bpy.data.objects.remove(obj, do_unlink=True)

    # Brighten Mixamo materials so night stadium lighting still reads.
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                col = node.inputs.get("Base Color")
                if col is not None:
                    # Lift very dark base colors toward mid-grey before team tint.
                    r, g, b, a = col.default_value
                    if (r + g + b) / 3.0 < 0.25:
                        col.default_value = (0.55, 0.55, 0.58, 1.0)
                rough = node.inputs.get("Roughness")
                if rough is not None:
                    rough.default_value = min(0.85, max(0.35, rough.default_value))

    # Alias clips the runtime state machine looks for.
    # Prefer real Idle/Running FBX when present; otherwise clone Pass/Tackle.
    aliases = {
        "Idle": "SoccerPass",
        "Running": "SoccerTackle",
        "Kick": "SoccerKick",
        "Run": "Running",
    }
    # If real Idle/Running already exist from CLIP_SOURCES, skip alias overwrite
    for alias, source in aliases.items():
        if bpy.data.actions.get(alias) is not None:
            continue
        src = bpy.data.actions.get(source)
        if src is None:
            continue
        dup = src.copy()
        dup.name = alias
        dup.use_fake_user = True
        print(f"Alias {alias} <- {source}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Select armature + children meshes for export
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    for child in arm.children:
        child.select_set(True)
    # Also select any mesh parented elsewhere
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=str(OUT),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_anim_single_armature=True,
        export_apply=False,
        export_yup=True,
    )
    size = OUT.stat().st_size
    print(f"Wrote {OUT} ({size / 1024:.0f} KiB)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"merge_mixamo_fbx failed: {exc}", file=sys.stderr)
        raise
