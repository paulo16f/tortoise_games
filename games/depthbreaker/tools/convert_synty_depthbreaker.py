"""LEGACY: Blender-based Depthbreaker Synty GLB builder.

The active character pipeline is now Unity Humanoid retarget export via
`My project (1)/Assets/Editor/DepthbreakerGltfExport.cs`. Keep this file only as
historical fallback/reference; do not use it for approved runtime character GLBs.

Build Depthbreaker-ready Synty Dungeon Realms GLBs with named clips.

The active v1 runtime uses Polygon Dungeon Realms characters because they share
the same bone names as the Polygon locomotion/combat animation packs. Keep this
pipeline direct: no Mini Fantasy retarget and no Sidekick fallback in runtime
assets.

Run with Blender:
blender --background --python tools/convert_synty_depthbreaker.py -- --source "C:\\Users\\vlgp6\\Projects\\unity sheets\\Source_Files" --restored "C:\\Users\\vlgp6\\Projects\\unity sheets\\_restored" --out client\\public\\models\\synty\\depthbreaker
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


DEFAULT_SOURCE = Path(r"C:\Users\vlgp6\Projects\unity sheets\Source_Files")
DEFAULT_RESTORED = Path(r"C:\Users\vlgp6\Projects\unity sheets\_restored")
DEFAULT_OUT = Path("client/public/models/synty/depthbreaker")
DUNGEON_REALMS_CHARACTERS = "Assets/Synty/PolygonDungeonRealms/Models/Characters/Characters.fbx"
WEAPON_TEXTURE_NAME = "PolygonMinis_Texture_01_A.png"


@dataclass(frozen=True)
class RuntimeCharacter:
    mesh: str
    out: str


CHARACTERS = [
    RuntimeCharacter("Chr_Hero_Male_01", "characters/warrior.glb"),
    RuntimeCharacter("Chr_Nomad_Male_01", "characters/warden.glb"),
    RuntimeCharacter("Chr_Nomad_Female_01", "characters/mage.glb"),
    RuntimeCharacter("Chr_Skeleton_01", "characters/skeleton.glb"),
    RuntimeCharacter("Chr_Undead_Knight_01", "characters/undead_knight.glb"),
    RuntimeCharacter("Chr_Skeleton_03", "characters/boss_skeleton.glb"),
]

_LOCO = "Assets/Synty/AnimationBaseLocomotion/Animations/Polygon/Masculine"
_SWORD = "Assets/Synty/AnimationSwordCombat/Animations/Polygon"

CLIPS = {
    # Prefer Polygon clips over Sidekick for Dungeon Realms / standard POLYGON
    # rigs. Keep this as the single runtime source of truth: if a clip choice
    # changes, regenerate these GLBs instead of branching at runtime.
    "idle": f"{_SWORD}/Idle/Base/A_Idle_Base_Sword.fbx",
    "walk": f"{_LOCO}/Locomotion/Walk/A_Walk_F_Masc.fbx",
    "run": f"{_LOCO}/Locomotion/Run/A_Run_F_Masc.fbx",
    "sprint": f"{_LOCO}/Locomotion/Sprint/A_Sprint_F_Masc.fbx",
    # One-shot locomotion transitions (start/stop) that the runtime locomotion
    # controller fires when leaving/entering idle. Baked like any other clip;
    # the runtime degrades to the plain speed blend when a GLB lacks them.
    "walk_start": f"{_LOCO}/Transitions/Idle_ToWalk/A_Idle_ToWalkF_Masc.fbx",
    "run_start": f"{_LOCO}/Transitions/Idle_ToRun/A_Idle_ToRunF_Masc.fbx",
    "walk_stop": f"{_LOCO}/Transitions/Walk_ToIdle/A_Walk_ToIdleF_RFoot_Masc.fbx",
    "run_stop": f"{_LOCO}/Transitions/Run_ToIdle/A_Run_ToIdleF_RFoot_Masc.fbx",
    # Turn-in-place (played when the body rotates while standing still).
    "turn_l": f"{_LOCO}/Locomotion/Turn/A_Turn_Standing_90L_Masc.fbx",
    "turn_r": f"{_LOCO}/Locomotion/Turn/A_Turn_Standing_90R_Masc.fbx",
    "attack": f"{_SWORD}/Attack/LightCombo01/A_Attack_LightCombo01A_Sword.fbx",
    "block": f"{_SWORD}/Block/A_Block_Loop_Sword.fbx",
    "hit": f"{_SWORD}/Hit/HitReact/A_Hit_F_React_Sword.fbx",
    "death": f"{_SWORD}/Death/A_Death_F_01_Sword.fbx",
}

# The runtime foot-locks locomotion playback to real ground speed, which needs
# each looping clip's authored ground speed. The base clips above are IN-PLACE
# (no root travel - the server drives position), so we read forward travel from
# their _RootMotion_ siblings instead and store it normalized by character
# height (scale-invariant). Runtime: Vnat = normStride * visualHeight / duration.
STRIDE_ROOTMOTION = {
    "walk": f"{_LOCO}/Locomotion/Walk/A_Walk_F_RootMotion_Masc.fbx",
    "run": f"{_LOCO}/Locomotion/Run/A_Run_F_RootMotion_Masc.fbx",
    "sprint": f"{_LOCO}/Locomotion/Sprint/A_Sprint_F_RootMotion_Masc.fbx",
}

# Arm-chain bones whose rest differs anatomically (character T-pose vs animation
# A-pose). The delta retarget preserves the target rest, so T-pose arms stay
# splayed out; the hybrid bake copies the source's ABSOLUTE orientation for these
# (arm bone-frame diff is small), while body/legs keep the delta method.
ARM_ABSOLUTE_BONES = frozenset({"Clavicle_L", "Shoulder_L", "Elbow_L", "Hand_L", "Clavicle_R", "Shoulder_R", "Elbow_R", "Hand_R"})

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
    parser.add_argument("--skip-weapons", action="store_true", help="Only rebuild character GLBs (weapons are unchanged).")
    parser.add_argument("--only", type=str, default="", help="Comma-separated output-name substrings to bake (e.g. 'warrior'); empty = all.")
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


def _curve_owners(action: bpy.types.Action) -> list:
    owners = []
    if hasattr(action, "fcurves"):
        owners.append(action)
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for bag in getattr(strip, "channelbags", []):
                if hasattr(bag, "fcurves"):
                    owners.append(bag)
    return owners


def strip_root_motion(action: bpy.types.Action) -> None:
    for owner in _curve_owners(action):
        for curve in list(owner.fcurves):
            if curve.data_path in {
                'pose.bones["Root"].location',
                'pose.bones["root"].location',
            }:
                owner.fcurves.remove(curve)


def count_action_fcurves(action: bpy.types.Action) -> int:
    return sum(len(owner.fcurves) for owner in _curve_owners(action))


def hierarchy_depth(pose_bone: bpy.types.PoseBone) -> int:
    depth = 0
    parent = pose_bone.parent
    while parent is not None:
        depth += 1
        parent = parent.parent
    return depth


def reset_pose(armature: bpy.types.Object) -> None:
    for pose_bone in armature.pose.bones:
        pose_bone.location = (0, 0, 0)
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = (1, 0, 0, 0)
        pose_bone.scale = (1, 1, 1)


def bake_retargeted_action(
    target_armature: bpy.types.Object,
    source_armature: bpy.types.Object,
    source_action: bpy.types.Action,
    clip_name: str,
) -> bpy.types.Action:
    """Bake a Synty Polygon clip onto the Dungeon Realms rig in armature space.

    The animation packs and Dungeon Realms characters share bone names but NOT
    rest orientations (measured: Hips/Spine differ ~120 deg), so we transfer each
    bone's world-space pose delta relative to its own rest and re-anchor it on the
    target rest bone. Two things make this robust where a naive version flipped
    the deep upper-body chain ~180 deg per frame:
      1. Target matrices are set parent-first, one hierarchy level at a time, with
         a view_layer update between levels so every child reads its ALREADY
         updated parent (a stale parent world matrix on the 8-deep arm chain was
         the main cause of the flips; the 4-deep leg chain escaped it).
      2. Quaternion sign continuity is enforced per keyframe so adjacent frames
         never interpolate the long way around.
    """

    source_armature.animation_data_create()
    source_armature.animation_data.action = source_action
    target_armature.animation_data_create()
    target_action = bpy.data.actions.new(clip_name)
    target_action.use_fake_user = True
    target_armature.animation_data.action = target_action

    source_bones = source_armature.pose.bones
    target_bones = target_armature.pose.bones
    common_names = [name for name in target_bones.keys() if name in source_bones]
    if len(common_names) < 30:
        raise RuntimeError(f"{clip_name}: only {len(common_names)} common bones between source and target")

    depths = {name: hierarchy_depth(target_bones[name]) for name in common_names}
    levels = sorted(set(depths.values()))
    bones_by_level = {lv: [n for n in common_names if depths[n] == lv] for lv in levels}
    prev_q: dict[str, object] = {}

    start, end = source_action.frame_range
    start_i = int(start)
    end_i = int(end)
    scene = bpy.context.scene
    old_frame = scene.frame_current

    # Default reproduces the shipped assets: delta retarget for body/legs +
    # absolute copy for the arm chain (see ARM_ABSOLUTE_BONES), with hierarchy-
    # level updates and quaternion continuity (no tremble). Arm poses are still
    # imperfect (T-pose vs A-pose rest mismatch) - tracked as post-launch polish.
    method = os.environ.get("DB_RETARGET", "hybrid")

    # Per-bone parent-relative rest rotation, for the localx frame conjugation.
    def local_rest_rot(bones, name):
        bone = bones[name].bone
        m = bone.parent.matrix_local.inverted() @ bone.matrix_local if bone.parent is not None else bone.matrix_local
        return m.to_quaternion()

    xconv = os.environ.get("DB_XCONV", "st")  # 'st' => Xs^-1 @ Xt, 'ts' => Xt^-1 @ Xs
    conj = {}
    for name in common_names:
        rs = local_rest_rot(source_bones, name)
        rt = local_rest_rot(target_bones, name)
        conj[name] = (rs.inverted() @ rt) if xconv == "st" else (rt.inverted() @ rs)

    for source_frame in range(start_i, end_i + 1):
        scene.frame_set(source_frame)
        bpy.context.view_layer.update()
        reset_pose(target_armature)

        if method == "localx":
            # Copy each bone's local pose delta (matrix_basis, relative to its own
            # rest) but re-express it in the target bone's local frame via the
            # per-bone rest-frame conjugation `conj`. Handles differing rest poses
            # (T-pose char vs A-pose anims) without hierarchy accumulation.
            dst_frame = source_frame - start_i
            for bone_name in common_names:
                source_pose = source_bones[bone_name]
                target_pose = target_bones[bone_name]
                target_pose.rotation_mode = "QUATERNION"
                d = source_pose.matrix_basis.to_quaternion()
                x = conj[bone_name]
                apply = os.environ.get("DB_APPLY", "conj")
                if apply == "left":
                    q = x @ d          # fold the rest offset in (T-pose -> A-pose)
                elif apply == "right":
                    q = d @ x
                else:
                    q = x @ d @ x.inverted()
                prev = prev_q.get(bone_name)
                if prev is not None and q.dot(prev) < 0:
                    q.negate()
                prev_q[bone_name] = q.copy()
                target_pose.rotation_quaternion = q
                target_pose.keyframe_insert(data_path="rotation_quaternion", frame=dst_frame)
                if bone_name == "Hips":
                    target_pose.location = source_pose.matrix_basis.translation
                    target_pose.keyframe_insert(data_path="location", frame=dst_frame)
        elif method == "absolute":
            # Copy each bone's ABSOLUTE world orientation from the source (the
            # target mimics the source directly, keeping its own bone positions),
            # so differing rest poses (source arms-down vs target T-pose) don't
            # bias the result. Parent-first with per-level updates so positions
            # cascade correctly.
            sw = source_armature.matrix_world
            tw_inv = target_armature.matrix_world.inverted()
            for lv in levels:
                for bone_name in bones_by_level[lv]:
                    source_pose = source_bones[bone_name]
                    target_pose = target_bones[bone_name]
                    desired = tw_inv @ sw @ source_pose.matrix  # source bone in target armature space
                    loc = target_pose.matrix.translation.copy()
                    target_pose.matrix = Matrix.Translation(loc) @ desired.to_quaternion().to_matrix().to_4x4()
                bpy.context.view_layer.update()
            dst_frame = source_frame - start_i
            for bone_name in common_names:
                target_pose = target_bones[bone_name]
                target_pose.rotation_mode = "QUATERNION"
                if bone_name == "Root":
                    target_pose.location = (0, 0, 0)
                q = target_pose.rotation_quaternion.copy()
                prev = prev_q.get(bone_name)
                if prev is not None and q.dot(prev) < 0:
                    q.negate()
                    target_pose.rotation_quaternion = q
                prev_q[bone_name] = q.copy()
                target_pose.keyframe_insert(data_path="rotation_quaternion", frame=dst_frame)
                if bone_name == "Hips":
                    target_pose.keyframe_insert(data_path="location", frame=dst_frame)
        elif method in ("world", "hybrid"):
            # Delta transfer (bone's armature-space pose delta relative to its own
            # rest -> target rest). In 'hybrid', arm-chain bones instead copy the
            # source's ABSOLUTE orientation so T-pose arm rests don't leave arms
            # splayed out. Set matrices parent-first, updating between hierarchy
            # levels so children read updated parents.
            arm_absolute = method == "hybrid"
            sw = source_armature.matrix_world
            tw_inv = target_armature.matrix_world.inverted()
            for lv in levels:
                for bone_name in bones_by_level[lv]:
                    source_pose = source_bones[bone_name]
                    target_pose = target_bones[bone_name]
                    if arm_absolute and bone_name in ARM_ABSOLUTE_BONES:
                        desired = tw_inv @ sw @ source_pose.matrix
                        loc = target_pose.matrix.translation.copy()
                        target_pose.matrix = Matrix.Translation(loc) @ desired.to_quaternion().to_matrix().to_4x4()
                    else:
                        source_rest = source_pose.bone.matrix_local
                        target_rest = target_pose.bone.matrix_local
                        source_delta = source_pose.matrix @ source_rest.inverted()
                        target_pose.matrix = source_delta @ target_rest
                bpy.context.view_layer.update()
            dst_frame = source_frame - start_i
            for bone_name in common_names:
                target_pose = target_bones[bone_name]
                target_pose.rotation_mode = "QUATERNION"
                if bone_name == "Root":
                    target_pose.location = (0, 0, 0)
                q = target_pose.rotation_quaternion.copy()
                prev = prev_q.get(bone_name)
                if prev is not None and q.dot(prev) < 0:
                    q.negate()
                    target_pose.rotation_quaternion = q
                prev_q[bone_name] = q.copy()
                target_pose.keyframe_insert(data_path="rotation_quaternion", frame=dst_frame)
                if bone_name == "Hips":
                    target_pose.keyframe_insert(data_path="location", frame=dst_frame)
        else:
            # LOCAL: copy each bone's local pose delta (matrix_basis, relative to
            # its own rest, independent of parent -> no hierarchy accumulation, no
            # flips). Assumes source & target share bone-local axes.
            dst_frame = source_frame - start_i
            for bone_name in common_names:
                source_pose = source_bones[bone_name]
                target_pose = target_bones[bone_name]
                target_pose.rotation_mode = "QUATERNION"
                basis = source_pose.matrix_basis
                q = basis.to_quaternion()
                prev = prev_q.get(bone_name)
                if prev is not None and q.dot(prev) < 0:
                    q.negate()
                prev_q[bone_name] = q.copy()
                target_pose.rotation_quaternion = q
                target_pose.keyframe_insert(data_path="rotation_quaternion", frame=dst_frame)
                if bone_name == "Hips":
                    target_pose.location = basis.translation
                    target_pose.keyframe_insert(data_path="location", frame=dst_frame)

    scene.frame_set(old_frame)
    target_action.frame_start = 0
    target_action.frame_end = max(1, end_i - start_i)
    strip_root_motion(target_action)
    if count_action_fcurves(target_action) == 0:
        raise RuntimeError(f"{clip_name}: baked action has no fcurves")
    reset_pose(target_armature)
    return target_action


def stash_action(target_armature: bpy.types.Object, source_action: bpy.types.Action, clip_name: str) -> None:
    action = source_action
    action.name = clip_name
    action.use_fake_user = True
    strip_root_motion(action)
    if count_action_fcurves(action) == 0:
        raise RuntimeError(f"{clip_name}: action has no fcurves after root-motion strip")

    target_armature.animation_data_create()
    track = target_armature.animation_data.nla_tracks.new()
    track.name = clip_name
    strip = track.strips.new(clip_name, 0, action)
    strip.action = action
    start, end = action.frame_range
    strip.action_frame_start = start
    strip.action_frame_end = end
    strip.frame_start = 0
    strip.frame_end = max(1, end - start)


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
    baked_action = bake_retargeted_action(
        target_armature,
        source_armature,
        source_armature.animation_data.action,
        clip_name,
    )
    stash_action(target_armature, baked_action, clip_name)

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
        # Each runtime clip is stashed onto its own NLA track (see stash_action).
        # The default "ACTIONS" export mode bakes the pose from the object's
        # blended NLA stack instead of isolating each track, which reintroduces
        # the exact translation drift stash_action just stripped. NLA_TRACKS
        # solos each track for its own bake, matching how the clips are stored.
        export_animation_mode="NLA_TRACKS",
    )


def import_dungeon_realms_character(restored_root: Path, mesh_name: str) -> bpy.types.Object:
    character_path = restored_root / DUNGEON_REALMS_CHARACTERS
    import_fbx(character_path)
    target_armature = next(iter(armatures()), None)
    if target_armature is None:
        raise RuntimeError(f"No armature found in {character_path}")

    selected_mesh = bpy.data.objects.get(mesh_name)
    if selected_mesh is None or selected_mesh.type != "MESH":
        raise RuntimeError(f"Mesh {mesh_name} not found in {character_path}")

    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj.name != mesh_name:
            bpy.data.objects.remove(obj, do_unlink=True)

    target_armature.animation_data_clear()
    return target_armature


def measure_character_height(mesh_name: str) -> float:
    obj = bpy.data.objects.get(mesh_name)
    if obj is None or obj.type != "MESH":
        return 0.0
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    zs = [v.z for v in corners]
    return max(zs) - min(zs)


def measure_stride_norms(restored_root: Path, char_height: float) -> dict[str, float]:
    """Read forward ground travel from the _RootMotion_ locomotion clips (the
    in-place base clips carry no travel) and normalize by character height, so
    the runtime can foot-lock playback rate. Imports each FBX into a scratch
    scene; the caller's next clear_scene() reclaims the leftover armatures."""
    strides: dict[str, float] = {}
    if char_height <= 1e-4:
        return strides
    scene = bpy.context.scene
    for clip_name, rel in STRIDE_ROOTMOTION.items():
        path = restored_root / rel
        if not path.exists():
            print(f"[stride] skip {clip_name}: missing {path}")
            continue
        imported = import_fbx(path)
        arm = next((o for o in imported if o.type == "ARMATURE" and o.animation_data and o.animation_data.action), None)
        if arm is None:
            print(f"[stride] skip {clip_name}: no animated armature")
            continue
        bone = arm.pose.bones.get("Root") or arm.pose.bones.get("Hips")
        act = arm.animation_data.action
        start, end = act.frame_range
        first: Vector | None = None
        last: Vector | None = None
        for frame in range(int(start), int(end) + 1):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            world = (arm.matrix_world @ bone.matrix).translation.copy()
            if first is None:
                first = world
            last = world
        travel = last - first
        ground = (travel.x ** 2 + travel.y ** 2) ** 0.5
        strides[clip_name] = round(ground / char_height, 5)
        for obj in imported:
            try:
                bpy.data.objects.remove(obj, do_unlink=True)
            except Exception:
                pass
    return strides


def write_stride_sidecar(glb_path: Path, char_height: float, stride: dict[str, float]) -> None:
    """Persist per-clip normalized forward travel next to the GLB. The runtime
    foot-locks locomotion playback with: timeScale = groundSpeed /
    (strideNorm * visualHeight / clipDuration). See locomotionController.ts."""
    side = glb_path.with_suffix(".stride.json")
    side.write_text(json.dumps({"characterHeight": round(char_height, 5), "strideNorm": stride}, indent=2))
    print(f"[stride] wrote {side.name}: {stride}")


ARM_ALIGN_BONES = ["Shoulder_L", "Elbow_L", "Hand_L", "Shoulder_R", "Elbow_R", "Hand_R"]


def align_rest_arms(target_armature: bpy.types.Object, source_fbx: Path) -> None:
    """Re-rest the character's arm chain to match the animation rig's A-pose.

    The character mesh binds in a T-pose (arms straight out) but the Polygon
    locomotion clips are authored for an A-pose rig (arms down). Delta retargeting
    preserves each rig's rest, so T-pose arms stay splayed out. Fix it at the
    source: pose the arm bones to the source rig's rest orientation and apply that
    as the new bind pose, so arm rests match and delta retargeting then reproduces
    the source arm motion. Only the arm chain is re-rested; body/legs (which
    retarget correctly) keep their rest."""
    imported = import_fbx(source_fbx)
    source = next((o for o in imported if o.type == "ARMATURE"), None)
    if source is None:
        print("[align] no source armature; skipping arm rest alignment")
        return
    bpy.context.view_layer.update()
    sw = source.matrix_world
    tw_inv = target_armature.matrix_world.inverted()

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    target_armature.select_set(True)
    bpy.context.view_layer.objects.active = target_armature
    bpy.ops.object.mode_set(mode="POSE")
    for name in ARM_ALIGN_BONES:
        if name not in target_armature.pose.bones or name not in source.data.bones:
            continue
        tp = target_armature.pose.bones[name]
        src_rest_world = sw @ source.data.bones[name].matrix_local
        desired = (tw_inv @ src_rest_world).to_quaternion().to_matrix().to_4x4()
        loc = tp.matrix.translation.copy()
        tp.matrix = Matrix.Translation(loc) @ desired
        bpy.context.view_layer.update()
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    for obj in imported:
        try:
            bpy.data.objects.remove(obj, do_unlink=True)
        except Exception:
            pass
    target_armature.animation_data_clear()


def convert_character(character: RuntimeCharacter, restored_root: Path, out_root: Path) -> None:
    clear_scene()
    target_armature = import_dungeon_realms_character(restored_root, character.mesh)
    char_height = measure_character_height(character.mesh)

    # Off by default: bpy.ops.pose.armature_apply no-ops in --background, so the
    # arm rest-alignment is handled per-frame by the hybrid method instead.
    if os.environ.get("DB_ALIGN_ARMS", "0") != "0":
        align_rest_arms(target_armature, restored_root / CLIPS["walk"])

    for clip_name in CLIPS:
        add_clip(target_armature, restored_root / CLIPS[clip_name], clip_name)

    keep = set(CLIPS)
    for action in list(bpy.data.actions):
        if action.name not in keep:
            bpy.data.actions.remove(action)

    out_path = out_root / character.out
    export_glb(out_path)
    strides = measure_stride_norms(restored_root, char_height)
    write_stride_sidecar(out_path, char_height, strides)
    print(f"[ok] {character.out}")


def convert_weapon(source_root: Path, out_root: Path, relative_source: str, relative_out: str) -> None:
    clear_scene()
    import_fbx(source_root / relative_source)
    assign_texture(source_root / "Textures" / WEAPON_TEXTURE_NAME)
    export_glb(out_root / relative_out)
    print(f"[ok] {relative_out}")


def main() -> None:
    args = parse_args()
    source_root = args.source.resolve()
    restored_root = args.restored.resolve()
    out_root = args.out.resolve()

    only = [s.strip() for s in args.only.split(",") if s.strip()]
    for character in CHARACTERS:
        if only and not any(s in character.out for s in only):
            continue
        convert_character(character, restored_root, out_root)

    if only or args.skip_weapons:
        print("[skip] weapons (unchanged)")
        return
    for relative_source, relative_out in WEAPONS:
        convert_weapon(source_root, out_root, relative_source, relative_out)


if __name__ == "__main__":
    main()
