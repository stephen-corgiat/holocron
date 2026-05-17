import { CameraView } from './ha-source';

/**
 * Pure edge-detection + auto-close state machine for the doorbell glance.
 * This module holds *all* the logic worth
 * unit-testing; the React hook ({@link useDoorbellGlance}) is a thin shell that
 * feeds it snapshot deltas and a wall clock and owns only the `setTimeout`.
 *
 * The glance opens on the **rising edge** of `doorbell.rangAt` — a press whose
 * ISO timestamp is newer than the last one we acted on — and auto-closes after
 * {@link GLANCE_DURATION_MS}. A press *while open* resets that timer (a fresh
 * `openedAt`). The 3-min lifetime is deliberately decoupled from HA's ~15s
 * sensor pulse: the pulse only fires the open; this timer governs the close.
 */
export const GLANCE_DURATION_MS = 3 * 60 * 1000;

export interface DoorbellGlanceState {
  /** Whether the overlay is on screen. */
  open: boolean;
  /**
   * The newest `rangAt` we have acted on. A delta carrying this exact value
   * (or an older one) is *not* a rising edge — it's an echo of a press we
   * already opened for — so it neither re-opens nor resets the timer.
   */
  lastRangAt: string | null;
  /**
   * Wall-clock ms of the press that opened the *current* glance. Drives the
   * auto-close timer; bumps on every rising edge while open (the reset). Null
   * while closed.
   */
  openedAt: number | null;
  /** The camera the big frame is focused on (null ⇒ default to the doorbell). */
  focusCameraId: string | null;
}

export const initialDoorbellGlanceState: DoorbellGlanceState = {
  open: false,
  lastRangAt: null,
  openedAt: null,
  focusCameraId: null,
};

export type DoorbellGlanceAction =
  /** A snapshot/delta arrived; `rangAt` is `doorbell?.rangAt` (may be absent). */
  | { type: 'snapshot'; rangAt: string | undefined; now: number }
  /** Manual Dismiss. */
  | { type: 'dismiss' }
  /** The auto-close timer fired (only honored if it matches the open press). */
  | { type: 'autoClose'; openedAt: number }
  /** The user picked a different camera to view as the big frame. */
  | { type: 'pick'; cameraId: string };

/**
 * Is `next` a strictly-newer press than `prev`? ISO-8601 timestamps compare
 * correctly as strings, but we parse to be robust to differing precision /
 * offsets — a malformed value is treated as "not newer" (never opens).
 */
export function isRisingEdge(prev: string | null, next: string): boolean {
  const nextMs = Date.parse(next);
  if (Number.isNaN(nextMs)) return false;
  if (prev === null) return true;
  if (prev === next) return false;
  const prevMs = Date.parse(prev);
  if (Number.isNaN(prevMs)) return true;
  return nextMs > prevMs;
}

export function reduceDoorbellGlance(
  state: DoorbellGlanceState,
  action: DoorbellGlanceAction,
): DoorbellGlanceState {
  switch (action.type) {
    case 'snapshot': {
      if (action.rangAt === undefined) return state;
      if (!isRisingEdge(state.lastRangAt, action.rangAt)) return state;
      // Rising edge: open (or, if already open, reset) and refocus the big
      // frame on the doorbell camera. `openedAt` bumps so the timer restarts.
      return {
        open: true,
        lastRangAt: action.rangAt,
        openedAt: action.now,
        focusCameraId: null,
      };
    }
    case 'dismiss':
      // Stay closed but remember `lastRangAt` so the same press can't reopen.
      return { ...state, open: false, openedAt: null, focusCameraId: null };
    case 'autoClose':
      // Ignore a stale timer (a press reset the clock after it was scheduled).
      if (!state.open || state.openedAt !== action.openedAt) return state;
      return { ...state, open: false, openedAt: null, focusCameraId: null };
    case 'pick':
      if (!state.open) return state;
      return { ...state, focusCameraId: action.cameraId };
    default:
      return state;
  }
}

/**
 * Resolve which camera is the glance's big frame and which are the picker,
 * given the configured cameras and the current focus. The default focus is the
 * camera flagged `doorbell: true` (the front door); failing that, the first
 * camera. The picker is every *other* camera, order preserved.
 */
export function resolveGlanceCameras(
  cameras: CameraView[],
  focusCameraId: string | null,
): { focus: CameraView | null; others: CameraView[] } {
  if (cameras.length === 0) return { focus: null, others: [] };
  const doorbellCam = cameras.find((c) => c.doorbell);
  const focus =
    (focusCameraId !== null
      ? cameras.find((c) => c.id === focusCameraId)
      : undefined) ??
    doorbellCam ??
    cameras[0];
  const others = cameras.filter((c) => c.id !== focus.id);
  return { focus, others };
}
