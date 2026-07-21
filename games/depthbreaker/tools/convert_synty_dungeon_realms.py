"""Convert a curated POLYGON Dungeon Realms kit to GLB for Depthbreaker.

Run with Blender:
blender --background --python tools/convert_synty_dungeon_realms.py -- --restored "C:\\Users\\vlgp6\\Projects\\unity sheets\\_restored" --out client\\public\\models\\synty\\dungeon
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
DEFAULT_OUT = Path("client/public/models/synty/dungeon")
TEXTURE = "Assets/Synty/PolygonDungeonRealms/Textures/Dungeons_2_Texture_01_A.png"
MODEL_ROOT = "Assets/Synty/PolygonDungeonRealms/Models"


@dataclass(frozen=True)
class Asset:
    key: str
    category: str
    source: str
    out: str


ASSETS = [
    Asset("floor", "floor", "SM_Env_Dwarf_Floor_01.fbx", "floor.glb"),
    Asset("floor_cracked", "floor", "SM_Env_Dwarf_Floor_Crack_01.fbx", "floor_cracked.glb"),
    Asset("floor_half", "floor", "SM_Env_Dwarf_Floor_Half_01.fbx", "floor_half.glb"),
    Asset("wall", "wall", "SM_Env_Dwarf_Wall_01.fbx", "wall.glb"),
    Asset("wall_arch", "wall", "SM_Env_Dwarf_Wall_Archway_01.fbx", "wall_arch.glb"),
    Asset("wall_door", "wall", "SM_Env_Dwarf_Wall_DoorFrame_Single_01.fbx", "wall_door.glb"),
    Asset("wall_broken", "wall", "SM_Env_Dwarf_Wall_Broken_01.fbx", "wall_broken.glb"),
    Asset("pillar", "pillar", "SM_Env_Dwarf_Pillar_01.fbx", "pillar.glb"),
    Asset("stairs", "stairs", "SM_Env_Dwarf_Stairs_01.fbx", "stairs.glb"),
    Asset("bridge", "bridge", "SM_Env_Dwarf_Bridge_01.fbx", "bridge.glb"),
    Asset("barrel", "prop", "SM_Prop_Barrel_01.fbx", "barrel.glb"),
    Asset("barrel_broken", "prop", "SM_Prop_Barrel_Broken_01.fbx", "barrel_broken.glb"),
    Asset("rubble", "prop", "SM_Env_Rubble_Rocks_01.fbx", "rubble.glb"),
    Asset("rock_small", "prop", "SM_Env_Rock_Small_01.fbx", "rock_small.glb"),
    Asset("chest", "prop", "SM_Prop_Dwarf_TreasureChest_01.fbx", "chest.glb"),
    Asset("torch", "prop", "SM_Prop_Dwarf_Torch_01.fbx", "torch.glb"),
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
        "url": f"/models/synty/dungeon/{asset.out}",
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
        "sourcePack": "POLYGON Dungeon Realms",
        "scalePolicy": "Preserve Synty FBX scale; gameplay map uses shared rectangular collision.",
        "assets": [convert(asset, source_root, out_root, texture_path) for asset in ASSETS],
    }
    (out_root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"wrote {out_root / 'manifest.json'}")


if __name__ == "__main__":
    main()
