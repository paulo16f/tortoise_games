import { LoopOnce, LoopRepeat, type AnimationAction } from "three";
import type { MotionProfile } from "./motionProfiles";

/** Logical clip slots -> GLB clip names. Locomotion + transition slots are
 * optional so a GLB (or fallback) that lacks them degrades to the plain speed
 * blend. Baked by tools/convert_synty_depthbreaker.py. */
export interface ClipSet {
  idle: string;
  walk?: string;
  run: string;
  sprint?: string;
  walkStart?: string;
  runStart?: string;
  walkStop?: string;
  runStop?: string;
  turnLeft?: string;
  turnRight?: string;
  attack: string;
  hit: string;
  death: string;
}

export interface StrideNorm {
  walk?: number;
  run?: number;
  sprint?: number;
}

/** One frame of derived motion, produced by useCombatAnimState. */
export interface LocoInputs {
  /** Rendered ground speed (u/s), from useLocomotion. */
  speed: number;
  moving: boolean;
  /** Signed body yaw rate (rad/s); + is one turn direction. */
  yawRate: number;
  /** Non-null while a full-body combat clip should override locomotion. */
  combat: { kind: "attack" | "hit" | "death"; actionId?: string } | null;
  alive: boolean;
}

export interface ControllerConfig {
  actions: Record<string, AnimationAction | undefined>;
  clips: ClipSet;
  visualHeight: number;
  strideNorm?: StrideNorm;
  profile: MotionProfile;
}

interface Tier {
  action: AnimationAction;
  name: string;
  duration: number;
  /** Ground distance (world units) covered over one full clip cycle. */
  groundPerCycle: number;
  /** Real ground speed (u/s) at which this clip plays at natural cadence. */
  natural: number;
}

const EPS = 0.001;

/**
 * Client-side locomotion state machine over a character's baked Polygon clips.
 *
 * The core is a 1D speed blend across walk/run/sprint whose two active clips are
 * kept phase-synchronized: a single normalized cycle phase (advanced by real
 * ground speed / stride length) drives each clip's playback time. This is what
 * foot-locks the feet AND keeps the blended clips coherent - blending clips at
 * independent playback rates desyncs their stride phase and turns limbs to mush.
 * Idle is a discrete state (not cross-blended into walk, so its arm pose never
 * bleeds into locomotion); combat clips overlay everything as one-shots.
 *
 * Movement stays server-authoritative; this only decides how the already-
 * interpolated body is animated.
 */
export class LocomotionController {
  private readonly profile: MotionProfile;
  private readonly actions: Record<string, AnimationAction | undefined>;
  private readonly clips: ClipSet;
  private readonly idleName: string;
  private readonly locoTiers: Tier[]; // walk/run/sprint that exist, ascending by natural speed

  private readonly weights = new Map<string, number>();
  private phase = 0; // shared normalized locomotion cycle [0,1)
  private phaseNames: string[] = []; // actions whose .time is phase-driven this frame
  private locoMoving = false;
  private oneShot: { name: string; until: number } | null = null;
  private combatKey = "";

  constructor(cfg: ControllerConfig) {
    this.profile = cfg.profile;
    this.actions = cfg.actions;
    this.clips = cfg.clips;
    this.idleName = cfg.clips.idle;

    const tiers: Tier[] = [];
    const pushTier = (clipName: string | undefined, stride: number | undefined, fallback: number) => {
      if (!clipName) return;
      const action = cfg.actions[clipName];
      if (!action) return;
      const duration = action.getClip().duration || 1;
      const groundPerCycle = stride && stride > 0 ? stride * cfg.visualHeight : fallback * (cfg.visualHeight / 1.8) * duration;
      tiers.push({ action, name: clipName, duration, groundPerCycle, natural: groundPerCycle / duration });
    };
    pushTier(cfg.clips.walk, cfg.strideNorm?.walk, cfg.profile.fallbackNatural.walk);
    pushTier(cfg.clips.run, cfg.strideNorm?.run, cfg.profile.fallbackNatural.run);
    pushTier(cfg.clips.sprint, cfg.strideNorm?.sprint, cfg.profile.fallbackNatural.sprint);
    tiers.sort((a, b) => a.natural - b.natural);
    this.locoTiers = tiers;

    // Idle + all loco clips run continuously (weight 0 until blended in) so
    // their cycles stay phase-continuous.
    const idle = cfg.actions[this.idleName];
    if (idle) this.startLoop(idle);
    for (const tier of this.locoTiers) this.startLoop(tier.action);
  }

  private startLoop(action: AnimationAction): void {
    action.reset();
    action.setLoop(LoopRepeat, Infinity);
    action.enabled = true;
    action.weight = 0;
    action.timeScale = 1;
    action.play();
  }

  /** Advance the controller one frame. Call before mixer.update(delta). */
  update(inputs: LocoInputs, delta: number): void {
    const targets = this.computeTargets(inputs, delta);
    this.applyWeights(targets, delta);
    this.applyLocoPhase();
  }

  private computeTargets(inputs: LocoInputs, delta: number): Map<string, number> {
    const targets = new Map<string, number>();
    this.phaseNames = [];
    const now = performance.now();

    // 1) Combat overlays everything (attack / hit / death, full body, one-shot).
    if (inputs.combat) {
      const clipName = this.combatClip(inputs.combat.kind);
      const key = `${inputs.combat.kind}:${inputs.combat.actionId ?? inputs.combat.kind}`;
      if (clipName && this.combatKey !== key) {
        this.triggerOneShot(clipName, now, true);
        this.combatKey = key;
      }
      this.oneShot = null;
      if (clipName) {
        targets.set(clipName, 1);
        this.setTimeScale(clipName, inputs.combat.kind === "hit" ? 1.05 : 1);
      }
      return targets;
    }
    this.combatKey = "";

    const moving = inputs.moving && inputs.speed > this.profile.moveEnterSpeed;

    // 2) Start / stop transitions on the idle<->moving edge.
    if (this.profile.enableStartStop) {
      if (!this.locoMoving && moving) {
        const start = inputs.speed >= this.profile.runStartSpeed ? this.clips.runStart : this.clips.walkStart;
        if (start && this.actions[start]) this.triggerOneShot(start, now, false);
      } else if (this.locoMoving && !moving) {
        const stop = inputs.speed >= this.profile.runStartSpeed ? this.clips.runStop : this.clips.walkStop;
        if (stop && this.actions[stop]) this.triggerOneShot(stop, now, false);
      }
    }
    this.locoMoving = moving;

    // 3) An active transition one-shot plays exclusively until it ends.
    if (this.oneShot && now < this.oneShot.until) {
      targets.set(this.oneShot.name, 1);
      return targets;
    }
    this.oneShot = null;

    // 4) Turn-in-place while standing and rotating.
    if (!moving && this.profile.enableTurnInPlace && Math.abs(inputs.yawRate) > this.profile.turnRateEnter) {
      const turn = inputs.yawRate > 0 ? this.clips.turnLeft : this.clips.turnRight;
      if (turn && this.actions[turn]) {
        this.triggerOneShot(turn, now, false);
        targets.set(turn, 1);
        return targets;
      }
    }

    // 5) Standing: discrete idle (never cross-blended, so its arm pose can't
    // bleed into locomotion).
    if (!moving || this.locoTiers.length === 0) {
      targets.set(this.idleName, 1);
      this.setTimeScale(this.idleName, 1);
      return targets;
    }

    // 6) Moving: phase-synchronized speed blend across walk/run/sprint.
    this.computeLocoBlend(inputs.speed, delta, targets);
    return targets;
  }

  /** Cross-weight the two tiers bracketing `speed`, then advance the shared
   * cycle phase by real ground speed so both clips stay foot-locked & in sync. */
  private computeLocoBlend(speed: number, delta: number, targets: Map<string, number>): void {
    const tiers = this.locoTiers;
    let a: Tier;
    let b: Tier;
    let t: number;
    if (tiers.length === 1) {
      a = b = tiers[0];
      t = 0;
    } else {
      let lo = 0;
      while (lo < tiers.length - 2 && speed > tiers[lo + 1].natural) lo++;
      a = tiers[lo];
      b = tiers[lo + 1];
      const span = b.natural - a.natural;
      t = span > EPS ? (speed - a.natural) / span : 0;
      t = Math.max(0, Math.min(1, t));
    }

    targets.set(a.name, (targets.get(a.name) ?? 0) + (1 - t));
    if (b !== a) targets.set(b.name, (targets.get(b.name) ?? 0) + t);

    const groundPerCycle = a.groundPerCycle + (b.groundPerCycle - a.groundPerCycle) * t;
    if (groundPerCycle > EPS) {
      this.phase = (this.phase + (speed / groundPerCycle) * delta) % 1;
      if (this.phase < 0) this.phase += 1;
    }
    this.phaseNames = a === b ? [a.name] : [a.name, b.name];
  }

  /** Ease live weights toward targets; enable/disable actions accordingly. */
  private applyWeights(targets: Map<string, number>, delta: number): void {
    const rate = Math.min(1, delta * this.profile.blendRate);
    const names = new Set<string>([...this.weights.keys(), ...targets.keys()]);
    for (const name of names) {
      const cur = this.weights.get(name) ?? 0;
      const tgt = targets.get(name) ?? 0;
      let next = cur + (tgt - cur) * rate;
      if (tgt === 0 && next < EPS) next = 0;
      const action = this.actions[name];
      if (!action) {
        this.weights.delete(name);
        continue;
      }
      if (next <= 0) {
        action.weight = 0;
        if (!this.isLoop(name)) action.enabled = false;
        this.weights.delete(name);
      } else {
        if (!action.isRunning()) action.play();
        action.enabled = true;
        action.weight = next;
        this.weights.set(name, next);
      }
    }
  }

  /** Drive phase-synced loco clips by shared cycle phase (foot-lock + sync). */
  private applyLocoPhase(): void {
    for (const tier of this.locoTiers) {
      const active = this.phaseNames.includes(tier.name) && (this.weights.get(tier.name) ?? 0) > EPS;
      if (active) {
        tier.action.timeScale = 0; // time is driven manually below
        tier.action.time = this.phase * tier.duration;
      } else {
        tier.action.timeScale = 1; // let it free-run while faded out
      }
    }
  }

  private triggerOneShot(name: string, now: number, isCombat: boolean): void {
    const action = this.actions[name];
    if (!action) return;
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.enabled = true;
    action.timeScale = 1;
    action.play();
    if (!isCombat) this.oneShot = { name, until: now + (action.getClip().duration || 0.4) * 1000 };
  }

  private setTimeScale(name: string, scale: number): void {
    const action = this.actions[name];
    if (action) action.timeScale = scale;
  }

  private isLoop(name: string): boolean {
    return name === this.idleName || this.locoTiers.some((tier) => tier.name === name);
  }

  private combatClip(kind: "attack" | "hit" | "death"): string | undefined {
    const name = kind === "attack" ? this.clips.attack : kind === "hit" ? this.clips.hit : this.clips.death;
    return this.actions[name] ? name : undefined;
  }
}
