"""Headless visual QA for baked character clips: renders N evenly-spaced frames
of each clip into a single side-by-side contact-sheet PNG so animation quality
(e.g. arms flipping) can be eyeballed without a browser. Uses the Workbench
engine, which renders in --background with no GPU.

Run:
blender --background --python tools/render_clip_qa.py -- \
    --glb client/public/models/synty/depthbreaker/characters/warrior.glb \
    --clips walk,run,idle --frames 8 --out <dir>
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
import mathutils
import numpy as np

FRAME_W = 220
FRAME_H = 340


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--glb", type=Path, required=True)
    p.add_argument("--clips", type=str, default="walk,run,idle")
    p.add_argument("--frames", type=int, default=8)
    p.add_argument("--out", type=Path, required=True)
    return p.parse_args(argv)


def clear() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for coll in (bpy.data.actions, bpy.data.armatures, bpy.data.objects, bpy.data.meshes, bpy.data.images):
        for it in list(coll):
            try:
                coll.remove(it)
            except Exception:
                pass


def setup_scene() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = FRAME_W
    scene.render.resolution_y = FRAME_H
    scene.render.film_transparent = False
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.8, 0.82, 0.85)
    scene.world = bpy.data.worlds.new("w")
    scene.world.color = (0.05, 0.06, 0.08)

    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (2.6, -3.8, 1.2)
    direction = mathutils.Vector((0, 0, 1.0)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def find_armature() -> bpy.types.Object:
    return next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")


def render_frame(path: Path) -> None:
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def contact_sheet(arm: bpy.types.Object, clip_name: str, frames: int, out_dir: Path) -> None:
    action = next((a for a in bpy.data.actions if a.name == clip_name or clip_name in a.name), None)
    if action is None:
        print(f"[qa] clip {clip_name}: NO ACTION")
        return
    arm.animation_data_create()
    arm.animation_data.action = action
    start, end = action.frame_range
    scene = bpy.context.scene

    tiles = []
    for i in range(frames):
        f = start + (end - start) * (i / max(1, frames - 1))
        scene.frame_set(int(round(f)))
        bpy.context.view_layer.update()
        tmp = out_dir / f"_tmp_{clip_name}_{i}.png"
        render_frame(tmp)
        img = bpy.data.images.load(str(tmp))
        px = np.array(img.pixels[:], dtype=np.float32).reshape(FRAME_H, FRAME_W, 4)
        tiles.append(px)
        bpy.data.images.remove(img)
        tmp.unlink(missing_ok=True)

    sheet = np.concatenate(tiles, axis=1)  # side by side
    h, w = sheet.shape[0], sheet.shape[1]
    out_img = bpy.data.images.new(f"qa_{clip_name}", w, h, alpha=True)
    out_img.pixels = sheet.flatten()
    out_path = out_dir / f"qa_{clip_name}.png"
    out_img.filepath_raw = str(out_path)
    out_img.file_format = "PNG"
    out_img.save()
    bpy.data.images.remove(out_img)
    print(f"[qa] wrote {out_path}")


def main() -> None:
    args = parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    clear()
    bpy.ops.import_scene.gltf(filepath=str(args.glb.resolve()))
    setup_scene()
    arm = find_armature()
    for clip in args.clips.split(","):
        contact_sheet(arm, clip.strip(), args.frames, args.out)


if __name__ == "__main__":
    main()
