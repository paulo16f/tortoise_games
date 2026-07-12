// Procedural WebAudio SFX — no asset files (matches the project's asset-free
// conventions: canvas ground, emoji-SVG cursors). One lazily-created AudioContext
// unlocked on the first user gesture; every cue is synthesized from oscillators +
// noise bursts + gain envelopes. Subscribed to the combat bus so hits/crits/deaths
// fire in time with the visuals (using the same delayMs). Silence robs combat of
// weight — this is the highest juice-per-line layer.

import { combatBus } from "../../net/combatBus";
import { AUDIO_MANIFEST } from "./audioManifest";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
const MASTER_VOLUME = 0.32;

// --- Sample bank -------------------------------------------------------------
// Real audio files (when present in AUDIO_MANIFEST) take priority over the
// procedural synthesis below. undefined = not yet loaded, null = tried &
// unavailable (don't retry). Keeps the game audible with zero asset files today
// and upgrades to recorded sound the moment the user drops files + manifest keys.
const buffers = new Map<string, AudioBuffer | null>();
const loadingKeys = new Set<string>();

async function loadSample(key: string): Promise<void> {
  const url = AUDIO_MANIFEST[key];
  if (!url || buffers.has(key) || loadingKeys.has(key)) return;
  const c = ensure();
  if (!c) return;
  loadingKeys.add(key);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      buffers.set(key, null);
      return;
    }
    buffers.set(key, await c.decodeAudioData(await res.arrayBuffer()));
  } catch {
    buffers.set(key, null);
  } finally {
    loadingKeys.delete(key);
  }
}

/** Play a real sample if one is loaded for `key`. Returns false to fall back. */
function playSample(key: string, vol = 1, delay = 0): boolean {
  const c = ensure();
  if (!c || !master || muted) return false;
  const buf = buffers.get(key);
  if (buf === undefined) {
    if (AUDIO_MANIFEST[key]) void loadSample(key); // warm the cache for next time
    return false;
  }
  if (buf === null) return false;
  const g = c.createGain();
  g.gain.value = Math.max(0, vol);
  g.connect(master);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(g);
  src.start(c.currentTime + delay);
  return true;
}

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

// Throttle so a multi-hit AoE or a wave of DoT/aura ticks landing in the same
// frame collapses to one thwack instead of a wall of overlapping hits.
let lastHitAt = 0;
export function playHit(amount = 10): void {
  const now = performance.now();
  if (now - lastHitAt < 45) return;
  lastHitAt = now;
  if (playSample("hit", hitVol(amount))) return;
  tone({ freq: 190, dur: 0.09, type: "triangle", vol: hitVol(amount), sweepTo: 120 });
  noise({ dur: 0.05, vol: 0.18, freq: 2200, q: 0.6 });
}
export function playCrit(amount = 20): void {
  if (playSample("crit", hitVol(amount) + 0.12)) return;
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
  if (playSample("death")) return;
  tone({ freq: 130, dur: 0.32, type: "sine", vol: 0.4, sweepTo: 46 });
  noise({ dur: 0.24, vol: 0.24, freq: 500, q: 0.4 });
}
export function playHeal(): void {
  if (playSample("heal")) return;
  tone({ freq: 520, dur: 0.2, type: "sine", vol: 0.24, sweepTo: 880 });
}
export function playGold(): void {
  if (playSample("gold")) return;
  tone({ freq: 880, dur: 0.09, type: "square", vol: 0.22 });
  tone({ freq: 1320, dur: 0.1, type: "square", vol: 0.18, delay: 0.06 });
}
export function playLoot(): void {
  if (playSample("loot")) return;
  tone({ freq: 660, dur: 0.12, type: "triangle", vol: 0.22, sweepTo: 990 });
}
export function playGather(): void {
  if (playSample("gather")) return;
  tone({ freq: 300, dur: 0.08, type: "square", vol: 0.16, sweepTo: 220 });
  noise({ dur: 0.05, vol: 0.14, freq: 3000, q: 0.7 });
}

/** Skill → sonic family, for flavored procedural casts when no sample exists. */
const SKILL_FAMILY: Record<string, "fire" | "frost" | "holy" | "shadow" | "steel"> = {
  fireball: "fire",
  frost_nova: "frost",
  smite: "holy",
  mend: "holy",
  renew: "holy",
  blessing: "holy",
  corruption: "shadow",
  drain_life: "shadow",
  bone_spear: "shadow",
  bone_armor: "shadow",
  holy_nova: "holy",
  sanctuary: "holy",
  rupture: "steel",
  cleave: "steel",
  whirlwind: "steel",
  execute: "steel",
  charge: "steel",
  soul_reap: "steel",
  shield_wall: "steel",
  bulwark: "steel",
  taunt: "steel",
  basic_attack: "steel",
};

/** A cast cue for `skillId`: real sample if present, else a per-family synth. */
export function playSkillCast(skillId: string): void {
  if (playSample(`cast:${skillId}`)) return;
  if (playSample("skill")) return;
  switch (SKILL_FAMILY[skillId]) {
    case "fire":
      tone({ freq: 180, dur: 0.3, type: "sawtooth", vol: 0.24, sweepTo: 70 });
      noise({ dur: 0.28, vol: 0.2, freq: 1400, q: 0.5 });
      break;
    case "frost":
      tone({ freq: 1200, dur: 0.22, type: "sine", vol: 0.16, sweepTo: 1900 });
      tone({ freq: 1800, dur: 0.18, type: "triangle", vol: 0.1, sweepTo: 2600, delay: 0.02 });
      break;
    case "holy":
      tone({ freq: 660, dur: 0.34, type: "sine", vol: 0.2, sweepTo: 990 });
      tone({ freq: 990, dur: 0.3, type: "sine", vol: 0.12, sweepTo: 1320, delay: 0.03 });
      break;
    case "shadow":
      tone({ freq: 110, dur: 0.4, type: "sawtooth", vol: 0.2, sweepTo: 60 });
      noise({ dur: 0.3, vol: 0.12, freq: 400, q: 0.6 });
      break;
    case "steel":
      noise({ dur: 0.14, vol: 0.2, freq: 1100, q: 1.2 });
      tone({ freq: 300, dur: 0.1, type: "triangle", vol: 0.12, sweepTo: 180 });
      break;
    default:
      playSkill();
  }
}

// --- Dungeon ambience --------------------------------------------------------
let ambientNodes: { stop: () => void } | null = null;

/** Start the looping dungeon bed (real loop if present, else a soft cave drone). */
export function startAmbient(): void {
  const c = ensure();
  if (!c || !master || ambientNodes) return;
  const buf = buffers.get("ambient:dungeon");
  if (buf === undefined && AUDIO_MANIFEST["ambient:dungeon"]) {
    void loadSample("ambient:dungeon").then(() => {
      if (!ambientNodes) startAmbient();
    });
  }
  if (buf) {
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(master);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(g);
    src.start();
    g.gain.linearRampToValueAtTime(0.6, c.currentTime + 2);
    ambientNodes = { stop: () => { try { src.stop(); } catch { /* already stopped */ } } };
    return;
  }
  // Fallback: a gentle, slowly-modulated low cave drone (very low gain).
  const g = c.createGain();
  g.gain.value = 0;
  g.connect(master);
  g.gain.linearRampToValueAtTime(0.05, c.currentTime + 3);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 320;
  lp.connect(g);
  const o1 = c.createOscillator();
  o1.type = "sine";
  o1.frequency.value = 55;
  const o2 = c.createOscillator();
  o2.type = "sine";
  o2.frequency.value = 82.4;
  o1.connect(lp);
  o2.connect(lp);
  // Slow LFO on the filter cutoff for a breathing, cavernous feel.
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 120;
  lfo.connect(lfoGain).connect(lp.frequency);
  o1.start();
  o2.start();
  lfo.start();
  ambientNodes = {
    stop: () => {
      g.gain.linearRampToValueAtTime(0, c.currentTime + 0.5);
      [o1, o2, lfo].forEach((o) => { try { o.stop(c.currentTime + 0.6); } catch { /* noop */ } });
    },
  };
}

export function stopAmbient(): void {
  ambientNodes?.stop();
  ambientNodes = null;
}

let wired = false;
/** Subscribe combat cues to the bus + arm the first-gesture unlock. Idempotent. */
export function initCombatSfx(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;

  const unlock = () => {
    unlockAudio();
    // Warm the sample cache once the context can decode (post-gesture).
    for (const key of Object.keys(AUDIO_MANIFEST)) void loadSample(key);
  };
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
          // amount 0 = a cast/launch → per-skill cue; damage → an impact thwack.
          if (f.amount === 0) playSkillCast(f.skillId);
          else playHit(f.amount);
          break;
      }
    };
    if (f.delayMs > 0) window.setTimeout(fire, f.delayMs);
    else fire();
  });
}
