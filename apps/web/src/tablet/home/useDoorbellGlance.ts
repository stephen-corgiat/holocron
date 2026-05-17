import { useCallback, useEffect, useReducer } from 'react';
import {
  DoorbellGlanceState,
  GLANCE_DURATION_MS,
  initialDoorbellGlanceState,
  reduceDoorbellGlance,
} from './doorbell-glance';

export interface DoorbellGlance {
  /** Whether the overlay should be shown. */
  open: boolean;
  /** ISO timestamp of the press the overlay is showing (for the RANG label). */
  rangAt: string | null;
  /** The camera id the big frame is focused on, or null ⇒ default doorbell. */
  focusCameraId: string | null;
  dismiss: () => void;
  pick: (cameraId: string) => void;
}

/**
 * React shell around the pure {@link reduceDoorbellGlance} machine. Feeds it
 * the latest `doorbell.rangAt` and a wall clock, and owns the single
 * `setTimeout` that fires the 3-min auto-close. All edge
 * / reset logic lives in the pure reducer; this hook only bridges to React +
 * timers.
 *
 * `gated` is the combined-effort gate: the glance can open **only** when both
 * HA (a doorbell event is configured ⇒ `rangAt` can ever arrive) and Scrypted
 * (cameras configured) are present. When false, deltas are ignored — the
 * overlay never opens, while steady camera polling / HA controls still work
 * alone.
 */
export function useDoorbellGlance(
  rangAt: string | undefined,
  gated: boolean,
): DoorbellGlance {
  const [state, dispatch] = useReducer(
    reduceDoorbellGlance,
    initialDoorbellGlanceState,
  );

  // Fold each new `rangAt` (rising-edge detection is inside the reducer). When
  // ungated, never feed it forward — the overlay stays shut.
  useEffect(() => {
    if (!gated) return;
    dispatch({ type: 'snapshot', rangAt, now: Date.now() });
  }, [rangAt, gated]);

  // Auto-close: a single timer keyed on `openedAt`, so a press-driven reset
  // (which bumps `openedAt`) re-arms a fresh 3-min window and the prior timer
  // becomes a no-op (the reducer ignores a non-matching `openedAt`).
  const openedAt = state.openedAt;
  useEffect(() => {
    if (!state.open || openedAt === null) return;
    const id = setTimeout(
      () => dispatch({ type: 'autoClose', openedAt }),
      GLANCE_DURATION_MS,
    );
    return () => clearTimeout(id);
  }, [state.open, openedAt]);

  const dismiss = useCallback(() => dispatch({ type: 'dismiss' }), []);
  const pick = useCallback(
    (cameraId: string) => dispatch({ type: 'pick', cameraId }),
    [],
  );

  return {
    open: state.open,
    rangAt: state.lastRangAt,
    focusCameraId: state.focusCameraId,
    dismiss,
    pick,
  };
}

export type { DoorbellGlanceState };
