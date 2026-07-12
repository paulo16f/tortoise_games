// Procedural WebAudio SFX — no asset files (matches the project's asset-free
// conventions: canvas ground, emoji-SVG cursors). One lazily-created AudioContext
// unlocked on the first user gesture; every cue is synthesized from oscillators +
// noise bursts + gain envelopes. Subscribed to the combat bus so hits/crits/deaths
// fire in time with the visuals (using the same delayMs). Silence robs combat of
// weight — this is the highest juice-per-line layer.

import { combatBus } from "../../net/combatBus";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
const MASTER_VOLUME = 0.32;

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_VOLUME;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Resume the context after a user gesture (browsers block audio until then). */
export function unlockAudio(): void {
  const c = ensure();
  if (c && c.state === "suspended") void c.resume();
}

export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : MASTER_VOLUME;
}
export function isSfxMuted(): boolean {
  return muted;
}

/** A single enveloped oscillator voice. */
function tone(opts: {
  freq: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  sweepTo?: number;
  delay?: number;
}): void {
  const c = ensure();
  if (!c || !master || muted) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const vol = Math.max(0.0008, Math.min(1, opts.vol ?? 0.5));
  const g = c.createGain();
  g.connect(master);
  g.gain.setValueAtTime(0.0008, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + opts.dur);
  const osc = c.createOscillator();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t0 + opts.dur);
  osc.connect(g);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
}

/** A short filtered noise burst (impact transient / whoosh). */
function noise(opts: { dur: number; vol?: number; freq?: number; q?: number; delay?: number }): void {
  const c = ensure();
  if (!c || !master || muted) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const frames = Math.floor(c.sampleRate * opts.dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  // Deterministic-ish pseudo-noise (Math.random is fine — cosmetic, client-only).
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = opts.freq ?? 1200;
  bp.Q.value = opts.q ?? 0.8;
  const g = c.createGain();
  g.gain.value = Math.max(0.0008, Math.min(1, opts.vol ?? 0.4));
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.02);
}

// --- Named cues ---------------------------------------------------------------

/** Louder for bigger hits so damage magnitude is audible. */
function hitVol(amount: number): number {
  return 0.28 + Math.min(0.4, Math.abs(amount) / 120);
}

export function playHit(amount = 10): void {
  tone({ freq: 190, dur: 0.09, type: "triangle", vol: hitVol(amount), sweepTo: 120 });
  noise({ dur: 0.05, vol: 0.18, freq: 2200, q: 0.6 });
}
export function playCrit(amount = 20): void {
  const v = hitVol(amount) + 0.12;
  tone({ freq: 240, dur: 0.16, type: "sawtooth", vol: v, sweepTo: 90 });
  tone({ freq: 480, dur: 0.1, type: "square", vol: v * 0.5, sweepTo: 220, delay: 0.005 });
  noise({ dur: 0.09, vol: 0.32, freq: 1600, q: 0.5 });
}
export function playSwing(): void {
  noise({ dur: 0.11, vol: 0.14, freq: 900, q: 1.4 });
}
export function playSkill(): void {
  tone({ freq: 320, dur: 0.18, type: "triangle", vol: 0.28, sweepTo: 720 });
}
export function playDeath(): void {
  tone({ freq: 130, dur: 0.32, type: "sine", vol: 0.4, sweepTo: 46 });
  noise({ dur: 0.24, vol: 0.24, freq: 500, q: 0.4 });
}
export function playHeal(): void {
  tone({ freq: 520, dur: 0.2, type: "sine", vol: 0.24, sweepTo: 880 });
}
export function playGold(): void {
  tone({ freq: 880, dur: 0.09, type: "square", vol: 0.22 });
  tone({ freq: 1320, dur: 0.1, type: "square", vol: 0.18, delay: 0.06 });
}
export function playLoot(): void {
  tone({ freq: 660, dur: 0.12, type: "triangle", vol: 0.22, sweepTo: 990 });
}
export function playGather(): void {
  tone({ freq: 300, dur: 0.08, type: "square", vol: 0.16, sweepTo: 220 });
  noise({ dur: 0.05, vol: 0.14, freq: 3000, q: 0.7 });
}

let wired = false;
/** Subscribe combat cues to the bus + arm the first-gesture unlock. Idempotent. */
export function initCombatSfx(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;

  const unlock = () => unlockAudio();
  window.addEventListener("pointerdown", unlock, { once: false });
  window.addEventListener("keydown", unlock, { once: false });

  combatBus.subscribe((f) => {
    const fire = () => {
      switch (f.kind) {
        case "crit":
          playCrit(f.amount);
          break;
        case "hit":
          playHit(f.amount);
          break;
        case "death":
          playDeath();
          break;
        case "heal":
          playHeal();
          break;
        case "skill":
          if (f.amount === 0) playSkill();
          else playHit(f.amount); // a damaging skill still thwacks
          break;
      }
    };
    if (f.delayMs > 0) window.setTimeout(fire, f.delayMs);
    else fire();
  });
}
