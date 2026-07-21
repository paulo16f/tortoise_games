# Plan: Complete the 4 class kits — 7 fun, distinct skills each

**For:** Claude Fable 5 (switch model, then execute). Context from this session is
already loaded — combat/skill engine, VFX/SFX/anim wiring, balance history.

**Effort:** medium. Bump to high only for a genuinely hard balance fork.

## Goal (single, narrow)

Bring **all 4 classes to a complete, distinct, FUN 7-skill kit.** That's the whole
job. The **token economy is the product**; gameplay only needs to be "fun enough,"
so keep this lean — reuse existing systems, add zero new architecture, no rabbit
holes. **No Necromancer minion/pet** (too complex — explicitly cut by the user).

## Current state (verified)

| Class | Kit today | Count | Add |
|---|---|---|---|
| **Knight** | basic_attack, cleave, shield_wall, whirlwind, taunt, execute, bulwark | **7 ✓** | tune only |
| **Reaper** | basic_attack, cleave, soul_reap, whirlwind, charge, execute | **6** | **+1** |
| **Cleric** | basic_attack, smite, mend, renew, blessing | **5** | **+2** |
| **Necromancer** | basic_attack, fireball, frost_nova, corruption | **4** | **+3** |

**6 new skills total.** Free home slots (per-kit, no collision — `skills.test`
enforces): Reaper → slot 6; Cleric → slots 4, 6; Necromancer → slots 4, 5, 6.

## Design principle: REUSE effects, add zero new `SkillEffect` types

All effect types already exist in `packages/protocol/src/skills.ts`:
`basic_attack, melee_cone, radial_aoe, projectile_aoe, aura_dot, dot,
lifesteal_strike, execute, dash_strike, heal_self, heal_ally, self_buff
(damage_reduction | damage_amp), self_immunity, taunt`. Every new skill below maps
onto one of these, so the work is mostly **data** (new `SkillDef`s + extend
`CLASS_KITS`) plus a few **registry entries** (VFX/icon/SFX). `runEffect` in
`realtime/src/ZoneRoom.ts` already handles all these types.

## Class identities (target fantasy)

- **Knight** — tank/bruiser. Taunt + mitigation + sustained melee AoE + execute. **Done; tune only.**
- **Reaper** — drain-DPS melee glass cannon. Mobility, lifesteal, bleed, AoE, execute.
- **Cleric** — **solo-viable** healer. Single + AoE nuke, self-heal, ally-heal, damage buff, defensive ward. Balanced damage AND support (user's explicit ask).
- **Necromancer** — squishy ranged affliction caster. Nuke, burst, control, DoT, drain sustain, defensive.

## The 6 new skills (proposal — Fable 5 finalizes numbers/feel)

**Reaper +1 — `rupture` (slot 6):** melee strike that applies a **bleed**.
Effect: `dot` (like `corruption`, melee range). Synergizes with `soul_reap` sustain.
Learn ~L5. Family: `steel`/`shadow`. `clip:"attack"`.

**Cleric +2:**
- **`holy_nova` (slot 4):** point-blank **radial holy AoE** burst. Effect:
  `radial_aoe`. Gives the cleric real AoE damage. Learn ~L4. Family: `holy`.
  `clip:"cast"`.
- **`sanctuary` (slot 6):** self **damage-reduction ward**. Effect: `self_buff`
  (`damage_reduction`), like `shield_wall`. The solo-survivability button. Learn
  ~L6. Family: `holy`. `clip:"cast"`.

**Necromancer +3 (no minion):**
- **`drain_life` (slot 4):** **ranged lifesteal** nuke → sustain for the fragile
  caster. Effect: `lifesteal_strike` at **range ~12**. ⚠️ **Only possible new code:**
  verify the `lifesteal_strike` case in `runEffect` honors the skill's `range`
  rather than hardcoding melee reach; if it does hardcode, make it range-driven (or
  fire it as a projectile). Minor. Learn ~L4. Family: `shadow`. `clip:"cast"`.
- **`bone_spear` (slot 5):** single-target **projectile nuke** (small radius, high
  single-target damage — distinct from `fireball`'s AoE explosion). Effect:
  `projectile_aoe`. Learn ~L5. Family: `shadow`. `clip:"cast"`.
- **`bone_armor` (slot 6):** self **damage-reduction** shield → survivability.
  Effect: `self_buff` (`damage_reduction`). Learn ~L6. Family: `shadow`.
  `clip:"cast"`.

> If Fable 5 judges Necromancer has one too many defensives (drain + bone_armor),
> it may swap `bone_armor` for a more offensive reuse (e.g. a second `dot` "wither"
> or a `radial_aoe`) — but keep to existing effect types.

## Wiring checklist (per new skill)

1. **`packages/protocol/src/skills.ts`** — add the `SkillDef` (id, label, slot,
   learnLevel, cooldown, gcd, `effects[]`, `clip?`); append the id to its class's
   `CLASS_KITS` array. Match numeric conventions of the nearest existing skill.
2. **`client/src/game/fx/skillVfx.ts`** — add a `SKILL_VFX[id]` entry (impact/
   projectile/ground/cast spec) so it looks distinct. Reuse an existing family look.
3. **`client/src/ui/hudIcons.ts`** — add `SKILL_ICONS[id]`. Extract a fitting glyph
   from the Dark Fantasy `Icons_Status` set via
   `node tools/extract_unitypackage_pngs.mjs` → `client/public/ui/synty/icons/skill_<id>.png`,
   or reuse a close existing icon.
4. **`client/src/game/fx/sfx.ts`** — map the id to a `SKILL_FAMILY` (fire/frost/
   holy/shadow/steel) so the procedural cast sound fits.
5. The client hotbar/skill book is data-driven — new skills appear automatically.

## Tuning pass (secondary — keep light)

After the kits are complete, one light balance/feel pass so each class is fun and
roughly balanced, **all four solo-viable** (economy focus = everyone can farm the
loop): damage / range / cooldown / learnLevel, and hitbox windup + radius/reach for
melee. Reference the recent audit tweaks in git history. Don't over-tune.

## Verification (must stay green)

- `npm run typecheck`
- `npm test` — update `packages/protocol` `skills.test` expectations: kit counts
  (all 4 now = 7), distinct-identity + per-kit **no-slot-collision** + "full kit at
  level cap" assertions, and add the 6 new ids. **Do not modify the frozen
  `shared-spec/` sim vectors**; only add new vectors if a new-skill sim test needs
  them.
- `npm run smoke:classes` — extend `tools/smoke_classes.mjs` to fire each new
  signature skill. Also `smoke:combat`, `smoke:skills`.

## Grounding (optional, at start)

- Invoke `/tortoise-games-studio` once for design + guardrail grounding.
- `world-of-claudecraft` reference repo = the proven ability-system / validation-
  ladder pattern this kit engine is modeled on.

## Out of scope (do NOT touch)

HUD/UI visuals (user deferred), Solana/token economy (launch-blocked), animation
GLB re-export (user's art step), Necromancer minion.
