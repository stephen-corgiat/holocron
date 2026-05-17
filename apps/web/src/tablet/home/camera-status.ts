// Pure FE-derived camera freshness state machine. There is **no** server `ageMs`: the tablet derives fresh / stale /
// offline purely from the `<img>`'s load/error events over the 5s refresh
// cycle, and **always keeps the last successfully-loaded frame** — a failed
// refresh never blanks the tile.
//
// Kept pure (no React, no timers, no DOM) so the rules are unit-testable in
// isolation; the component owns the actual `<img>` and the swap timer and just
// folds events through `reduceCameraState` + reads `deriveCameraStatus`.

/** How fresh the tile is, derived from load/error history. */
export type CameraStatus = 'fresh' | 'stale' | 'offline';

/**
 * The refresh interval (ms) at which the `<img>` `src` swaps (5s). One
 * canonical knob — the staleness thresholds are expressed in *cycles* of this.
 */
export const CAMERA_REFRESH_MS = 5_000;

/**
 * No successful `onload` for more than this many refresh cycles ⇒ stale
 * (last-good frame dimmed + amber badge). ~3 cycles per the issue.
 */
export const STALE_AFTER_CYCLES = 3;

/**
 * This many consecutive `onerror`s (with no intervening success) ⇒ offline
 * ("camera offline" placeholder over the last-good frame). Two in a row is a
 * real outage rather than one dropped frame.
 */
export const OFFLINE_AFTER_ERRORS = 2;

/**
 * Per-camera load history. Pure data — the component holds one of these per
 * tile and feeds it events. `lastGoodAt`/`lastGoodSrc` are the frame to keep
 * showing; `null` means we have never loaded a frame yet (initial loading).
 */
export interface CameraState {
  /** Timestamp (ms) of the most recent successful load, or null if none yet. */
  lastGoodAt: number | null;
  /** The `src` of the last frame that loaded — what stays on screen on failure. */
  lastGoodSrc: string | null;
  /** Consecutive `onerror`s since the last successful load. */
  consecutiveErrors: number;
}

export function initialCameraState(): CameraState {
  return { lastGoodAt: null, lastGoodSrc: null, consecutiveErrors: 0 };
}

/** Events the component folds in. `at` is the wall-clock ms when it happened. */
export type CameraEvent =
  | { type: 'load'; src: string; at: number }
  | { type: 'error'; at: number };

/**
 * Fold one `<img>` event into the per-camera state. Pure: a successful load
 * clears the error streak and records the good frame; an error only bumps the
 * streak and **never** drops the last-good frame.
 */
export function reduceCameraState(
  state: CameraState,
  event: CameraEvent,
): CameraState {
  switch (event.type) {
    case 'load':
      return { lastGoodAt: event.at, lastGoodSrc: event.src, consecutiveErrors: 0 };
    case 'error':
      return { ...state, consecutiveErrors: state.consecutiveErrors + 1 };
  }
}

export interface CameraStatusOptions {
  refreshMs?: number;
  staleAfterCycles?: number;
  offlineAfterErrors?: number;
}

/**
 * Derive the display status from the history at time `now`.
 *
 * - **offline** when errors have piled up past the threshold (repeated
 *   `onerror`) — a genuine outage.
 * - **stale** when the last good frame is older than `staleAfterCycles`
 *   refresh cycles (refreshes silently stopped succeeding, but not erroring
 *   hard).
 * - **fresh** otherwise.
 *
 * Before the first successful load the tile is treated as **fresh** (loading)
 * unless it has already erupted into errors — so a never-yet-loaded camera
 * that immediately fails goes straight to offline rather than sitting "fresh".
 */
export function deriveCameraStatus(
  state: CameraState,
  now: number,
  options: CameraStatusOptions = {},
): CameraStatus {
  const refreshMs = options.refreshMs ?? CAMERA_REFRESH_MS;
  const staleAfterCycles = options.staleAfterCycles ?? STALE_AFTER_CYCLES;
  const offlineAfterErrors = options.offlineAfterErrors ?? OFFLINE_AFTER_ERRORS;

  if (state.consecutiveErrors >= offlineAfterErrors) return 'offline';

  if (state.lastGoodAt === null) {
    // Never loaded a frame. One stray error isn't yet "offline" (handled
    // above); otherwise we're still in the initial fresh/loading window.
    return 'fresh';
  }

  const ageMs = now - state.lastGoodAt;
  if (ageMs > staleAfterCycles * refreshMs) return 'stale';
  return 'fresh';
}

/**
 * Build the next `src` for a tile from its `urlTemplate`: substitute
 * a fresh `{ts}` cache-buster and the single canonical `{width}` everywhere.
 * Templates without the placeholders pass through unchanged but still get the
 * timestamp appended so the browser/proxy cache is always defeated.
 */
export function buildCameraSrc(
  urlTemplate: string,
  width: number,
  ts: number,
): string {
  const hasTs = urlTemplate.includes('{ts}');
  let out = urlTemplate
    .replace(/\{ts\}/g, String(ts))
    .replace(/\{width\}/g, String(width));
  if (!hasTs) {
    out += (out.includes('?') ? '&' : '?') + `ts=${ts}`;
  }
  return out;
}
