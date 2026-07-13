import { LoopOnce, LoopRepeat, type AnimationAction } from "three";
import type { MotionProfile } from "./motionProfiles";

export const LOCOMOTION_BUILD = "v1-forward-locomotion";
// eslint-disable-next-line no-console
console.log(`%c[depthbreaker] locomotion controller: ${LOCOMOTION_BUILD}`, "color:#38bdf8;font-weight:bold");

/** Active V1 clip contract. Extra clips may exist in GLBs, but gameplay ignores them until Unity QA approves them. */
export interface ClipSet {
  idle: string;
  walk?: string;
  run: string;
  attack: string;
  hit: string;
  death: string;
}

export interface StrideNorm {
  walk?: number;
  run?: number;
}

export interface LocoInputs {
  speed: number;
  moving: boolean;
  backwards?: boolean;
  yawRate: number;
  combat: { kind: "attack" | "hit" | "death"; actionId?: string; clip?: string } | null;
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
  groundPerCycle: number;
  natural: number;
}

const EPS = 0.001;

/**
 * V1 animation controller: forward-only idle/walk/run plus server-driven
 * attack/hit/death one-shots. Movement direction is handled by Player/Enemy
 * yaw; this controller never tries strafe, turn-in-place, start/stop, or sprint
 * until those Synty clips are explicitly approved in Unity Preview.
 */
export class LocomotionController {
  private readonly profile: MotionProfile;
  private readonly actions: Record<string, AnimationAction | undefined>;
  private readonly clips: ClipSet;
  private readonly idleName: string;
  private readonly locoTiers: Tier[];

  private readonly weights = new Map<string, number>();
  private phase = 0;
  private phaseNames: string[] = [];
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
    tiers.sort((a, b) => a.natural - b.natural);
    this.locoTiers = tiers;

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

  update(inputs: LocoInputs, delta: number): void {
    const targets = this.computeTargets(inputs, delta);
    this.applyWeights(targets, delta);
    this.applyLocoPhase();
  }

  private computeTargets(inputs: LocoInputs, delta: number): Map<string, number> {
    const targets = new Map<string, number>();
    this.phaseNames = [];

    if (inputs.combat) {
      const clipName = this.combatClip(inputs.combat.kind, inputs.combat.clip);
      const key = `${inputs.combat.kind}:${inputs.combat.clip ?? ""}:${inputs.combat.actionId ?? inputs.combat.kind}`;
      if (clipName && this.combatKey !== key) {
        this.triggerOneShot(clipName, inputs.combat.kind);
        this.combatKey = key;
      }
      if (clipName) targets.set(clipName, 1);
      return targets;
    }
    this.combatKey = "";

    const moving = inputs.moving && inputs.speed > this.profile.moveEnterSpeed;
    if (!moving || this.locoTiers.length === 0) {
      targets.set(this.idleName, 1);
      this.setTimeScale(this.idleName, 1);
      return targets;
    }

    this.computeLocoBlend(inputs.speed, inputs.backwards ? -delta : delta, targets);
    return targets;
  }

  private computeLocoBlend(speed: number, delta: number, targets: Map<string, number>): void {
    const tiers = this.locoTiers;
    let a: Tier;
    let b: Tier;
    let t: number;
    if (tiers.length === 1 || speed <= tiers[0].natural) {
      a = b = tiers[0];
      t = 0;
    } else if (speed >= tiers[tiers.length - 1].natural) {
      a = b = tiers[tiers.length - 1];
      t = 0;
    } else {
      a = tiers[0];
      b = tiers[1];
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

  private isCombatClip(name: string): boolean {
    return name === this.clips.attack || name === this.clips.hit || name === this.clips.death;
  }

  private applyWeights(targets: Map<string, number>, delta: number): void {
    const locoRate = Math.min(1, delta * this.profile.blendRate);
    // Combat one-shots (attack/hit/death) snap in much faster than locomotion so
    // a swing/flinch reads on the frame it starts instead of ramping ~180ms.
    const combatRate = Math.min(1, delta * 26);
    const names = new Set<string>([...this.weights.keys(), ...targets.keys()]);
    for (const name of names) {
      const rate = this.isCombatClip(name) ? combatRate : locoRate;
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

  private applyLocoPhase(): void {
    for (const tier of this.locoTiers) {
      const active = this.phaseNames.includes(tier.name) && (this.weights.get(tier.name) ?? 0) > EPS;
      if (active) {
        tier.action.timeScale = 0;
        tier.action.time = this.phase * tier.duration;
      } else {
        tier.action.timeScale = 1;
      }
    }
  }

  private triggerOneShot(name: string, kind: "attack" | "hit" | "death" = "attack"): void {
    const action = this.actions[name];
    if (!action) return;
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.enabled = true;
    // Fit the clip into the server's action window so it always COMPLETES
    // instead of being chopped when the action ends: source packs author
    // luxurious clips (heavy combo 2.1s, hit react 0.9s) but the server
    // windows are snappy (~0.6s swing, 0.3s hit-react, 4s death). Speeding
    // the clip up (never slowing it down) reads as a full, punchy motion.
    const budget = kind === "hit" ? 0.34 : kind === "death" ? 3.5 : 0.62;
    const duration = action.getClip().duration;
    action.timeScale = Math.max(1, duration / budget);
    action.play();
  }

  private setTimeScale(name: string, scale: number): void {
    const action = this.actions[name];
    if (action) action.timeScale = scale;
  }

  private isLoop(name: string): boolean {
    return name === this.idleName || this.locoTiers.some((tier) => tier.name === name);
  }

  private combatClip(kind: "attack" | "hit" | "death", preferred?: string): string | undefined {
    // A skill can request its own clip (e.g. "cast"); honor it only if the GLB
    // actually bakes that action, otherwise fall back to the generic swing —
    // so setting a skill's `clip` ahead of the art never breaks animation.
    if (preferred && this.actions[preferred]) return preferred;
    const name = kind === "attack" ? this.clips.attack : kind === "hit" ? this.clips.hit : this.clips.death;
    return this.actions[name] ? name : undefined;
  }
}
