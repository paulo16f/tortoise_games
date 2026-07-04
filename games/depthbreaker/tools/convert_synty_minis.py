"""Convert selected Synty Mini Fantasy FBX source files to runtime GLB.

Run with Blender, for example:
blender --background --python tools/convert_synty_minis.py -- --source "C:\\Users\\vlgp6\\Projects\\unity sheets\\Source_Files" --out client\\public\\models\\synty
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy


DEFAULT_SOURCE = Path(r"C:\Users\vlgp6\Projects\unity sheets\Source_Files")
DEFAULT_OUT = Path("client/public/models/synty")
TEXTURE_NAME = "PolygonMinis_Texture_01_A.png"

ASSETS = [
    ("Characters/SK_Dungeon_KnightMale_01.fbx", "characters/sk_dungeon_knight_male.glb"),
    ("Characters/SK_Adventure_Warrior_01.fbx", "characters/sk_adventure_warrior.glb"),
    ("Characters/SK_Fantasy_Wizard_01.fbx", "characters/sk_fantasy_wizard.glb"),
    ("Characters/SK_Dungeon_SkeletonSoldier_01.fbx", "characters/sk_dungeon_skeleton_soldier.glb"),
    ("Characters/SK_Dungeon_GoblinChief_01.fbx", "characters/sk_dungeon_goblin_chief.glb"),
    ("Characters/SK_Dungeon_RockGolem_01.fbx", "characters/sk_dungeon_rock_golem.glb"),
    ("FBX/Prop_Sword_01.fbx", "weapons/prop_sword.glb"),
    ("FBX/Prop_Staff_01.fbx", "weapons/prop_staff.glb"),
    ("FBX/Prop_ShieldKnight_01.fbx", "weapons/prop_shield_knight.glb"),
]


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


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


def convert_one(source_path: Path, out_path: Path, texture_path: Path) -> bool:
    if not source_path.exists():
        print(f"[skip] missing: {source_path}")
        return False

    clear_scene()
    bpy.ops.import_scene.fbx(filepath=str(source_path), use_anim=True)
    assign_texture(texture_path)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_apply=False,
    )
    print(f"[ok] {source_path.name} -> {out_path}")
    return True


def main() -> None:
    args = parse_args()
    source_root = args.source.resolve()
    out_root = args.out.resolve()
    texture_path = source_root / "Textures" / TEXTURE_NAME

    converted = 0
    for relative_source, relative_out in ASSETS:
        if convert_one(source_root / relative_source, out_root / relative_out, texture_path):
            converted += 1

    print(f"Converted {converted}/{len(ASSETS)} assets into {out_root}")


if __name__ == "__main__":
    main()
