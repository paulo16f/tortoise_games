// Pure derivation of the auto-attack swing-timer bar, adapted from
// world-of-claudecraft's src/ui/swing_timer.ts. DOM-free and allocation-light so
// it stays unit-testable without a HUD.
//
// WoCC recovered the full swing period from the reset edge because it only had
// the countdown. Depthbreaker's server replicates BOTH the countdown
// (`swingCooldown`) and the full period (`swingInterval`), so the fraction is a
// direct read — no edge-tracking needed. The bar fills toward 1 as the next
// swing nears and reads "ready" at 0.

export interface SwingPlayerInput {
  autoAttack: boolean;
  /** Seconds until the next swing; counts down to 0 (= ready). */
  swingCooldown: number;
  /** Full swing period in seconds; 0 until the server assigns a profile. */
  swingInterval: number;
}

/** Target fields the bar reads; null when there is no current target. */
export interface SwingTargetInput {
  alive: boolean;
}

export interface SwingTimerState {
  /** Whether the bar is shown this frame. */
  visible: boolean;
  /** 0..1 fill width; grows toward 1 as the next swing nears. */
  frac: number;
  /** swingCooldown <= 0: the swing is up (highlight + ready label). */
  ready: boolean;
}

const HIDDEN: SwingTimerState = { visible: false, frac: 0, ready: false };

export function swingTimerState(
  player: SwingPlayerInput,
  target: SwingTargetInput | null,
): SwingTimerState {
  const liveTarget = target !== null && target.alive;
  if (!player.autoAttack || !liveTarget || player.swingInterval <= 0) return HIDDEN;

  const cooldown = Math.max(0, player.swingCooldown);
  const frac = clamp01(1 - cooldown / player.swingInterval);
  return { visible: true, frac, ready: cooldown <= 0 };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
