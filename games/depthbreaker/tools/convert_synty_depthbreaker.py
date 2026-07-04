"""Build Depthbreaker-ready Synty GLBs with named gameplay clips.

This script combines a Mini Fantasy character FBX with Polygon animation FBXs
from the Synty animation packs, then exports one GLB per runtime character.

Run with Blender:
blender --background --python tools/convert_synty_depthbreaker.py -- --source "C:\\Users\\vlgp6\\Projects\\unity sheets\\Source_Files" --restored "C:\\Users\\vlgp6\\Projects\\unity sheets\\_restored" --out client\\public\\models\\synty\\depthbreaker
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import bpy


DEFAULT_SOURCE = Path(r"C:\Users\vlgp6\Projects\unity sheets\Source_Files")
DEFAULT_RESTORED = Path(r"C:\Users\vlgp6\Projects\unity sheets\_restored")
DEFAULT_OUT = Path("client/public/models/synty/depthbreaker")
TEXTURE_NAME = "PolygonMinis_Texture_01_A.png"


@dataclass(frozen=True)
class RuntimeCharacter:
    source: str
    out: str


CHARACTERS = [
    RuntimeCharacter("Characters/SK_Dungeon_KnightMale_01.fbx", "characters/warrior.glb"),
    RuntimeCharacter("Characters/SK_Fantasy_Wizard_01.fbx", "characters/mage.glb"),
    RuntimeCharacter("Characters/SK_Dungeon_SkeletonSoldier_01.fbx", "characters/skeleton.glb"),
    RuntimeCharacter("Characters/SK_Dungeon_GoblinChief_01.fbx", "characters/goblin_chief.glb"),
    RuntimeCharacter("Characters/SK_Dungeon_RockGolem_01.fbx", "characters/rock_golem.glb"),
]

CLIPS = {
    "idle": "Assets/Synty/AnimationBaseLocomotion/Animations/Sidekick/Masculine/Idles/A_MOD_BL_Idle_Standing_Masc.fbx",
    "walk": "Assets/Synty/AnimationBaseLocomotion/Animations/Sidekick/Masculine/Locomotion/Walk/A_MOD_BL_Walk_F_Masc.fbx",
    "run": "Assets/Synty/AnimationBaseLocomotion/Animations/Sidekick/Masculine/Locomotion/Run/A_MOD_BL_Run_F_Masc.fbx",
    "attack": "Assets/Synty/AnimationSwordCombat/Animations/Sidekick/Attack/LightCombo01/A_MOD_SWD_Attack_LightCombo01A_Neut.fbx",
    "block": "Assets/Synty/AnimationSwordCombat/Animations/Sidekick/Block/A_MOD_SWD_Block_Loop_Neut.fbx",
    "hit": "Assets/Synty/AnimationSwordCombat/Animations/Sidekick/Hit/HitReact/A_MOD_SWD_Hit_F_React_Neut.fbx",
    "death": "Assets/Synty/AnimationSwordCombat/Animations/Sidekick/Death/A_MOD_SWD_Death_F_Neut.fbx",
}

WEAPONS = [
    ("FBX/Prop_Sword_01.fbx", "weapons/sword.glb"),
    ("FBX/Prop_Staff_01.fbx", "weapons/staff.glb"),
    ("FBX/Prop_ShieldKnight_01.fbx", "weapons/shield.glb"),
]


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--restored", type=Path, default=DEFAULT_RESTORED)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for collection in (
        bpy.data.actions,
        bpy.data.armatures,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.images,
    ):
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


def armatures() -> list[bpy.types.Object]:
    return [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]


def import_fbx(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), use_anim=True)
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def strip_missing_bone_curves(action: bpy.types.Action, target_armature: bpy.types.Object) -> None:
    target_bones = {bone.name for bone in target_armature.data.bones}
    curve_owners = []
    if hasattr(action, "fcurves"):
        curve_owners.append(action)
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for bag in getattr(strip, "channelbags", []):
                if hasattr(bag, "fcurves"):
                    curve_owners.append(bag)

    for owner in curve_owners:
        for curve in list(owner.fcurves):
            marker = 'pose.bones["'
            if marker not in curve.data_path:
                continue
            bone_name = curve.data_path.split(marker, 1)[1].split('"]', 1)[0]
            if bone_name not in target_bones:
                owner.fcurves.remove(curve)


def strip_unsafe_bone_translation_curves(action: bpy.types.Action) -> None:
    """Prevent FBX retarget translation tracks from stretching the runtime rig."""
    curve_owners = []
    if hasattr(action, "fcurves"):
        curve_owners.append(action)
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for bag in getattr(strip, "channelbags", []):
                if hasattr(bag, "fcurves"):
                    curve_owners.append(bag)

    for owner in curve_owners:
        for curve in list(owner.fcurves):
            if "pose.bones[" not in curve.data_path or not curve.data_path.endswith(".location"):
                continue
            if 'pose.bones["root"]' in curve.data_path:
                continue
            owner.fcurves.remove(curve)


def stash_action(target_armature: bpy.types.Object, source_action: bpy.types.Action, clip_name: str) -> None:
    action = source_action.copy()
    action.name = clip_name
    action.use_fake_user = True
    strip_missing_bone_curves(action, target_armature)
    strip_unsafe_bone_translation_curves(action)

    target_armature.animation_data_create()
    track = target_armature.animation_data.nla_tracks.new()
    track.name = clip_name
    strip = track.strips.new(clip_name, 0, action)
    strip.action = action


def add_clip(target_armature: bpy.types.Object, clip_path: Path, clip_name: str) -> None:
    if not clip_path.exists():
        raise FileNotFoundError(clip_path)

    imported = import_fbx(clip_path)
    imported_armatures = [obj for obj in imported if obj.type == "ARMATURE"]
    source_armature = next(
        (obj for obj in imported_armatures if obj.animation_data and obj.animation_data.action),
        None,
    )
    if source_armature is None:
        raise RuntimeError(f"No animated armature found in {clip_path}")

    source_armature_name = source_armature.name
    stash_action(target_armature, source_armature.animation_data.action, clip_name)

    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)

    for action in list(bpy.data.actions):
        if action.name != clip_name and action.name.startswith(source_armature_name):
            bpy.data.actions.remove(action)


def export_glb(out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_apply=False,
    )


def convert_character(character: RuntimeCharacter, source_root: Path, restored_root: Path, out_root: Path) -> None:
    clear_scene()
    character_path = source_root / character.source
    import_fbx(character_path)
    assign_texture(source_root / "Textures" / TEXTURE_NAME)

    target_armature = next(iter(armatures()), None)
    if target_armature is None:
        raise RuntimeError(f"No armature found in {character_path}")

    target_armature.animation_data_clear()
    for clip_name, relative_path in CLIPS.items():
        add_clip(target_armature, restored_root / relative_path, clip_name)

    keep = set(CLIPS)
    for action in list(bpy.data.actions):
        if action.name not in keep:
            bpy.data.actions.remove(action)

    export_glb(out_root / character.out)
    print(f"[ok] {character.out}")


def convert_weapon(source_root: Path, out_root: Path, relative_source: str, relative_out: str) -> None:
    clear_scene()
    import_fbx(source_root / relative_source)
    assign_texture(source_root / "Textures" / TEXTURE_NAME)
    export_glb(out_root / relative_out)
    print(f"[ok] {relative_out}")


def main() -> None:
    args = parse_args()
    source_root = args.source.resolve()
    restored_root = args.restored.resolve()
    out_root = args.out.resolve()

    for character in CHARACTERS:
        convert_character(character, source_root, restored_root, out_root)

    for relative_source, relative_out in WEAPONS:
        convert_weapon(source_root, out_root, relative_source, relative_out)


if __name__ == "__main__":
    main()
