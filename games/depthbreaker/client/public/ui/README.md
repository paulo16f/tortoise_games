# UI sprites (Synty INTERFACE - Dark Fantasy HUD)

`synty/` holds PNG sprites extracted from the **INTERFACE - Dark Fantasy HUD**
Synty pack (`.unitypackage`). No Unity needed — a `.unitypackage` is just a
gzipped tar, so `tools/extract_unitypackage_pngs.mjs` pulls the PNGs straight out.

Referenced from `client/src/ui/spriteKit.tsx` (the one place that maps sprite →
component). Currently wired: the HUD HP/XP bars and the hotbar slots.

## Pulling more sprites

```bash
# see what's in the pack (filter by name):
node tools/extract_unitypackage_pngs.mjs "C:/Users/vlgp6/Projects/unity sheets/INTERFACE_Dark_Fantasy_HUD_Unity_2022_3_v1_1_0.unitypackage" --list | grep -i frame

# extract specific ones into synty/ (renamed to their basenames):
node tools/extract_unitypackage_pngs.mjs "<pkg>" client/public/ui/synty Frame_Box_Large_01 Flask_01
```

The pack also contains, in useful named folders (for later phases):
- `Sprites/Icons_Status` — buff/debuff glyphs (→ skill icons)
- `Sprites/Icons_Weapons`, `Icons_Inventory`, `Icons_Resources` (→ item icons)
- `Sprites/DarkFantasy/…_Frame_Bar_*`, `…_Frame_Box_*` (bars + panel/slot frames)
- `Sprites/Flasks` (health/mana flasks)

## Tuning
Sprite choices + 9-slice insets live in `spriteKit.tsx` — swap a filename or a
`frameBorder(border, slice)` number and reload; nothing else to touch.
