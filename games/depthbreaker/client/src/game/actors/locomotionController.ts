import { LoopOnce, LoopRepeat, type AnimationAction } from "three";
import type { MotionProfile } from "./motionProfiles";

export const LOCOMOTION_BUILD = "v2-simple-idle-run";
// eslint-disable-next-line no-console
console.log(`%c[depthbreaker] locomotion controller: ${LOCOMOTION_BUILD}`, "color:#38bdf8;font-weight:bold");

/** Clip contract baked into every character GLB. `walk` is accepted for API
 *  compatibility but V2 locomotion is idle↔run only. */
export interface ClipSet {
  idle: string;
  walk?: string;
  run: string;
  attack: string;
  hit: string;
  death: string;
}

/** Kept for API compatibility (manifest + AnimatedCharacter still pass it). V2
 *  no longer foot-locks, so this is unused — remove once callers stop threading it. */
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

const EPS = 0.001;
// Ground speed (u/s) the run clip is roughly authored for. We nudge the run
// clip's playback rate toward the real move speed so feet don't skate — clamped
// so it never looks comically fast/slow. No per-clip stride metadata needed.
const RUN_REF_SPEED = 5;
const RUN_RATE_MIN = 0.8;
const RUN_RATE_MAX = 1.3;

/**
 * V2 locomotion: dead-simple idle↔run crossfade plus server-driven
 * attack/hit/death one-shots. No walk tier, no foot-lock/phase, no stride
 * metadata — the character is idle when still and runs when moving (direction is
 * handled by Player/Enemy yaw). Strafe / turn-in-place are intentionally omitted.
 */
export class LocomotionController {
  private readonly profile: MotionProfile;
  private readonly actions: Record<string, AnimationAction | undefined>;
  private readonly clips: ClipSet;
  private readonly idleName: string;
  private readonly runName: string | null;
  private readonly runAction: AnimationAction | null;

  private readonly weights = new Map<string, number>();
  private combatKey = "";

  constructor(cfg: ControllerConfig) {
    this.profile = cfg.profile;
    this.actions = cfg.actions;
    this.clips = cfg.clips;
    this.idleName = cfg.clips.idle;
    this.runAction = cfg.actions[cfg.clips.run] ?? null;
    this.runName = this.runAction ? cfg.clips.run : null;

    const idle = cfg.actions[this.idleName];
    if (idle) this.startLoop(idle);
    if (this.runAction) this.startLoop(this.runAction);
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
    const targets = this.computeTargets(inputs);
    this.applyWeights(targets, delta);
  }

  private computeTargets(inputs: LocoInputs): Map<string, number> {
    const targets = new Map<string, number>();

    // Combat wins outright: fire the one-shot on its rising edge, then hold full
    // weight while the (server-timed) swing/flinch/death plays.
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

    // Locomotion: idle when still, run when moving.
    const moving = inputs.moving && inputs.speed > this.profile.moveEnterSpeed;
    if (moving && this.runName && this.runAction) {
      targets.set(this.runName, 1);
      // Light rate sync so the stride roughly tracks ground speed (kills skating).
      this.runAction.timeScale = Math.max(RUN_RATE_MIN, Math.min(RUN_RATE_MAX, inputs.speed / RUN_REF_SPEED));
    } else {
      targets.set(this.idleName, 1);
    }
    return targets;
  }

  private isCombatClip(name: string): boolean {
    return name === this.clips.attack || name === this.clips.hit || name === this.clips.death;
  }

  private isLoop(name: string): boolean {
    return name === this.idleName || name === this.runName;
  }

  private applyWeights(targets: Map<string, number>, delta: number): void {
    const locoRate = Math.min(1, delta * this.profile.blendRate);
    // Combat one-shots snap in much faster than locomotion so a swing/flinch
    // reads on the frame it starts instead of ramping in.
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

  private triggerOneShot(name: string, kind: "attack" | "hit" | "death" = "attack"): void {
    const action = this.actions[name];
    if (!action) return;
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.enabled = true;
    // Fit the clip into the server's action window so it always COMPLETES
    // instead of being chopped: source packs author luxurious clips but the
    // server windows are snappy (~0.6s swing, 0.3s hit-react, 4s death).
    // Speeding up (never slowing) reads as a full, punchy motion.
    const budget = kind === "hit" ? 0.34 : kind === "death" ? 3.5 : 0.62;
    const duration = action.getClip().duration;
    action.timeScale = Math.max(1, duration / budget);
    action.play();
  }

  private combatClip(kind: "attack" | "hit" | "death", preferred?: string): string | undefined {
    // A skill can request its own clip (e.g. "cast"); honor it only if the GLB
    // actually bakes that action, else fall back to the generic swing.
    if (preferred && this.actions[preferred]) return preferred;
    const name = kind === "attack" ? this.clips.attack : kind === "hit" ? this.clips.hit : this.clips.death;
    return this.actions[name] ? name : undefined;
  }
}
