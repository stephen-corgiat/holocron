import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CameraView,
  FanState,
  HaSnapshot,
  ProxyHaSource,
  applyHaDelta,
} from './ha-source';

type SubscribeFn = (event: string, handler: (payload: unknown) => void) => () => void;

export interface HaSurface {
  snapshot: HaSnapshot | null;
  /**
   * True once the home surface is configured — i.e. the snapshot loaded
   * non-null, which happens when **either** HA controls **or** cameras are
   * configured (the module is wired on either). False ⇒ the home dock +
   * Routine/Home switch are hidden and the routine surface fills the screen
   * (the both-off cascade).
   */
  enabled: boolean;
  /** True when HA control creds are configured (drives the control panels). */
  haControlsEnabled: boolean;
  /** Number of lights/switches currently on (for the dock count). */
  lightsOn: number;
  /** Static camera config; empty when no cameras are configured. */
  cameras: CameraView[];
  /** The single canonical hotlink width to request everywhere. */
  snapshotWidth: number;
  toggle: (entityId: string, on: boolean) => Promise<void>;
  nudgeClimate: (entityId: string, dir: 1 | -1) => Promise<void>;
  setFan: (entityId: string, state: FanState) => Promise<void>;
  pressButton: (entityId: string) => Promise<void>;
  setBoolean: (entityId: string, on: boolean) => Promise<void>;
}

/**
 * Wires {@link ProxyHaSource} into React: fetches the snapshot once per token,
 * subscribes to live `ha:state_changed` deltas, and merges them. `enabled`
 * drives the gating cascade — false ⇒ the home dock + Routine/Home switch are
 * hidden and the routine surface fills the screen.
 */
export function useHaSource(token: string | null, on: SubscribeFn): HaSurface {
  const [snapshot, setSnapshot] = useState<HaSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  // `on` from useSocket is a fresh closure each render but closes over stable
  // refs; route through a ref so the source can stay memoized on the token.
  const onRef = useRef(on);
  useEffect(() => {
    onRef.current = on;
  });

  const source = useMemo(
    () =>
      token
        ? new ProxyHaSource(token, (event, handler) =>
            onRef.current(event, handler),
          )
        : null,
    [token],
  );

  useEffect(() => {
    if (!source) {
      setSnapshot(null);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    void source
      .getSnapshot()
      .then((s) => {
        if (cancelled) return;
        setSnapshot(s);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshot(null);
        setLoaded(true);
      });
    const unsubscribe = source.subscribe((delta) =>
      setSnapshot((prev) => (prev ? applyHaDelta(prev, delta) : prev)),
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [source]);

  const toggle = useCallback(
    (entityId: string, nextOn: boolean) =>
      source ? source.toggle(entityId, nextOn) : Promise.resolve(),
    [source],
  );
  const nudgeClimate = useCallback(
    (entityId: string, dir: 1 | -1) =>
      source ? source.nudgeClimate(entityId, dir) : Promise.resolve(),
    [source],
  );
  const setFan = useCallback(
    (entityId: string, state: FanState) =>
      source ? source.setFan(entityId, state) : Promise.resolve(),
    [source],
  );
  const pressButton = useCallback(
    (entityId: string) =>
      source ? source.pressButton(entityId) : Promise.resolve(),
    [source],
  );
  const setBoolean = useCallback(
    (entityId: string, on: boolean) =>
      source ? source.setBoolean(entityId, on) : Promise.resolve(),
    [source],
  );

  return {
    snapshot,
    enabled: loaded && snapshot !== null,
    haControlsEnabled: snapshot?.haEnabled ?? false,
    lightsOn: snapshot?.lights.length ?? 0,
    cameras: snapshot?.cameras ?? [],
    snapshotWidth: snapshot?.snapshotWidth ?? 768,
    toggle,
    nudgeClimate,
    setFan,
    pressButton,
    setBoolean,
  };
}
