# Higgsfield VFX prompt sheet

Generate each effect as a short clip, then run ONE command to get it in-game:

```
node tools/video_to_flipbook.mjs <clip.mp4> <name>
# prints the one line to paste into client/src/game/fx/skillVfx.ts
```

## Hard rules (every prompt MUST include these)

- **Pure black background (#000000)** — black becomes transparent in-game.
  If the tool offers a "background" setting, choose black/none.
- **Effect centered**, filling ~70% of frame
- **Square aspect ratio** (1:1) if selectable
- **2–3 seconds**, static camera, no zoom, no cuts
- No text, no watermark, no lens flare on the frame edges

Suggested prompt skeleton:
> "<EFFECT>, centered on a pure black background, VFX game asset, additive
> glow, square frame, static camera, 2 seconds, no text"

## Marquee batch (6 clips → name to use with the tool)

| # | Skill | Prompt core | tool name |
|---|---|---|---|
| 1 | Fireball impact | violent orange-red fire explosion burst, embers flying outward | `fireball_impact` |
| 2 | Holy Nova | golden holy light ring expanding outward, radiant shockwave on the ground, seen from above | `holy_nova_ground` |
| 3 | Soul Reap | crimson-red curved slash of energy, blood-like vapor trail | `soul_reap_impact` |
| 4 | Bone Spear | pale white-gray bone shards shattering outward, dusty burst | `bone_spear_impact` |
| 5 | Corruption | purple-black toxic pool bubbling on the ground, seen from above, dark tendrils | `corruption_ground` |
| 6 | Sanctuary | soft golden protective dome of light shimmering, gentle upward glow | `sanctuary_cast` |

Naming: `<skillId>_<slot>` where slot is `impact` (hit point, billboard),
`ground` (laid flat at the anchor), or `cast` (at the caster's chest).
After converting, paste the printed `sheet:` line into that skill's matching
slot (impact / ground / cast) in `skillVfx.ts`. Refresh the game — done.

Ground effects ("seen from above" prompts) read best; impact effects should
"burst outward from center". If a clip loops badly, trim it in Higgsfield —
the flipbook plays ONCE per trigger.
