import { useEffect, useReducer, useState } from 'react';
import {
  CAMERA_REFRESH_MS,
  CameraState,
  CameraStatus,
  buildCameraSrc,
  deriveCameraStatus,
  initialCameraState,
  reduceCameraState,
} from './camera-status';

export interface CameraFrame {
  /** The frame to actually render — always the last one that *loaded*, so a
   *  failed refresh never blanks the tile. `undefined` until the first load. */
  goodSrc: string | undefined;
  /** The candidate src being probed off-screen (hidden `<img>`). */
  probeSrc: string | undefined;
  /** Derived status (fresh / stale / offline) at the current tick. */
  status: CameraStatus;
  /** Raw history (for the age label). */
  state: CameraState;
  /** Current simulated/wall time the status was derived against. */
  now: number;
  /** Hook the hidden probe `<img>` up to these. */
  onProbeLoad: () => void;
  onProbeError: () => void;
}

/**
 * Drives one camera's snapshot lifecycle: swaps a candidate `src` every 5s
 * at the one canonical `{width}` with a fresh `{ts}` cache-buster,
 * and folds load/error through the pure state machine
 * (camera-status.ts). The visible frame (`goodSrc`) only ever updates on a
 * successful probe load — so a failing refresh keeps the last good frame.
 *
 * `visible` gates the swap timer: hidden tiles (off-screen surface) pause
 * refreshing and hold their last frame.
 */
export function useCameraFrame(
  urlTemplate: string,
  width: number,
  visible: boolean,
): CameraFrame {
  const [state, dispatch] = useReducer(
    reduceCameraState,
    undefined,
    initialCameraState,
  );
  const [probeSrc, setProbeSrc] = useState<string | undefined>(undefined);
  const [goodSrc, setGoodSrc] = useState<string | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const swap = () => {
      if (cancelled) return;
      setProbeSrc(buildCameraSrc(urlTemplate, width, Date.now()));
    };
    swap(); // load at once on first show, not after a full cycle
    const id = setInterval(swap, CAMERA_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [urlTemplate, width, visible]);

  // Re-derive freshness on the cadence so a tile that silently stops loading
  // ticks fresh → stale without needing a new load/error event.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CAMERA_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const onProbeLoad = () => {
    if (probeSrc === undefined) return;
    setGoodSrc(probeSrc); // promote the probe to the visible frame
    dispatch({ type: 'load', src: probeSrc, at: Date.now() });
  };
  const onProbeError = () => {
    // Leave goodSrc untouched — the last good frame stays on screen.
    dispatch({ type: 'error', at: Date.now() });
  };

  return {
    goodSrc,
    probeSrc,
    status: deriveCameraStatus(state, now),
    state,
    now,
    onProbeLoad,
    onProbeError,
  };
}
