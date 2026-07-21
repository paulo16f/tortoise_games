"""Convert a curated POLYGON Mini Fantasy world kit to GLB for Depthbreaker.

This is the companion world/environment pack for Polygon Mini Fantasy
Characters (already used for the player/enemy models) - it fixes the
stylistic mismatch between the mini characters and the realistically-modeled
POLYGON Dungeon Realms environment. Confirmed directly in Blender before
writing this script: SM_Tile_Cube_Flat_01 measures exactly 5.0 x 5.0 units,
the same grid DEPTHBREAKER_DUNGEON and Dungeon Realms already use - a direct
drop-in, no rescale needed. The curated list below is a small subset of the
~1000-asset pack (floor tile + dungeon-themed dressing), not the whole thing.

Run with Blender:
blender --background --python tools/convert_synty_mini_world.py -- --restored "C:\\Users\\vlgp6\\Projects\\unity sheets\\_restored" --out client\\public\\models\\synty\\mini_world
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import bpy
from mathutils import Vector


DEFAULT_RESTORED = Path(r"C:\Users\vlgp6\Projects\unity sheets\_restored")
DEFAULT_OUT = Path("client/public/models/synty/mini_world")
TEXTURE = "Assets/Synty/PolygonMiniFantasy/Textures/PolygonMiniFantasy_01.png"
MODEL_ROOT = "Assets/Synty/PolygonMiniFantasy/Models"


@dataclass(frozen=True)
class Asset:
    key: str
    category: str
    source: str
    out: str


ASSETS = [
    Asset("floor", "floor", "SM_Tile_Cube_Flat_01.fbx", "floor.glb"),
    Asset("floor_alt", "floor", "SM_Tile_Cube_Flat_02.fbx", "floor_alt.glb"),
    Asset("bones", "prop", "SM_Env_Dungeon_Bones_01.fbx", "bones.glb"),
    Asset("crystal", "prop", "SM_Env_Dungeon_Crystal_01.fbx", "crystal.glb"),
    Asset("crystal_alt", "prop", "SM_Env_Dungeon_Crystal_02.fbx", "crystal_alt.glb"),
    Asset("mushroom", "prop", "SM_Env_Dungeon_Mushroom_01.fbx", "mushroom.glb"),
    Asset("mushroom_alt", "prop", "SM_Env_Dungeon_Mushroom_02.fbx", "mushroom_alt.glb"),
    Asset("rocks", "prop", "SM_Env_Dungeon_Rocks_01.fbx", "rocks.glb"),
    Asset("skull", "prop", "SM_Env_Dungeon_Skull_01.fbx", "skull.glb"),
    Asset("stairs", "prop", "SM_Prop_Stairs_Stone_01.fbx", "stairs.glb"),
    Asset("chest_closed", "prop", "SM_Prop_TreasureChest_Closed_01.fbx", "chest_closed.glb"),
    Asset("chest_open", "prop", "SM_Prop_TreasureChest_Open_01.fbx", "chest_open.glb"),
    Asset("bridge", "prop", "SM_Prop_Generic_Bridge_01.fbx", "bridge.glb"),
    Asset("campfire", "prop", "SM_Prop_Generic_CampFire_01.fbx", "campfire.glb"),
    Asset("crate", "prop", "SM_Prop_Generic_Crate_01.fbx", "crate.glb"),
]


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--restored", type=Path, default=DEFAULT_RESTORED)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in list(collection):
            collection.remove(item)


def assign_texture(texture_path: Path) -> None:
    if not texture_path.exists():
        print(f"[warn] texture not found: {texture_path}")
        return
    image = bpy.data.images.load(str(texture_path), check_existing=True)
    for material in bpy.data.materials:
        material.use_nodes = True
        nodes = material.node_tree.nodes
        principled = nodes.get("Principled BSDF")
        if principled is None:
            continue
        texture = nodes.new(type="ShaderNodeTexImage")
        texture.image = image
        material.node_tree.links.new(texture.outputs["Color"], principled.inputs["Base Color"])


def scene_bounds() -> dict[str, list[float]]:
    mins = Vector((float("inf"), float("inf"), float("inf")))
    maxs = Vector((float("-inf"), float("-inf"), float("-inf")))
    found = False
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        found = True
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, world.x)
            mins.y = min(mins.y, world.y)
            mins.z = min(mins.z, world.z)
            maxs.x = max(maxs.x, world.x)
            maxs.y = max(maxs.y, world.y)
            maxs.z = max(maxs.z, world.z)
    if not found:
        mins = Vector((0, 0, 0))
        maxs = Vector((0, 0, 0))
    size = maxs - mins
    center = (mins + maxs) * 0.5
    return {
        "min": [round(v, 4) for v in mins],
        "max": [round(v, 4) for v in maxs],
        "size": [round(v, 4) for v in size],
        "center": [round(v, 4) for v in center],
    }


def convert(asset: Asset, source_root: Path, out_root: Path, texture_path: Path) -> dict[str, object]:
    source = source_root / asset.source
    if not source.exists():
        raise FileNotFoundError(source)
    clear_scene()
    bpy.ops.import_scene.fbx(filepath=str(source), use_anim=False)
    assign_texture(texture_path)
    out_path = out_root / asset.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_apply=False,
    )
    info = {
        "key": asset.key,
        "category": asset.category,
        "url": f"/models/synty/mini_world/{asset.out}",
        "source": f"{MODEL_ROOT}/{asset.source}",
        "bounds": scene_bounds(),
    }
    print(f"[ok] {asset.key} -> {out_path}")
    return info


def main() -> None:
    args = parse_args()
    restored = args.restored.resolve()
    out_root = args.out.resolve()
    source_root = restored / MODEL_ROOT
    texture_path = restored / TEXTURE

    manifest = {
        "sourcePack": "POLYGON Mini Fantasy",
        "scalePolicy": "Preserve Synty FBX scale; same 5m grid as POLYGON Dungeon Realms, confirmed by direct measurement.",
        "assets": [convert(asset, source_root, out_root, texture_path) for asset in ASSETS],
    }
    (out_root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"wrote {out_root / 'manifest.json'}")


if __name__ == "__main__":
    main()
