import { describe, it, expect } from 'vitest';
import {
  DoorbellGlanceState,
  GLANCE_DURATION_MS,
  initialDoorbellGlanceState,
  isRisingEdge,
  reduceDoorbellGlance,
  resolveGlanceCameras,
} from './doorbell-glance';
import { CameraView } from './ha-source';

const T0 = Date.parse('2026-05-31T19:42:08.000Z');
const PRESS_1 = '2026-05-31T19:42:08.000Z';
const PRESS_2 = '2026-05-31T19:45:30.000Z';

function snapshot(rangAt: string | undefined, now: number) {
  return { type: 'snapshot', rangAt, now } as const;
}

describe('isRisingEdge', () => {
  it('is a rising edge the first time any press is seen', () => {
    expect(isRisingEdge(null, PRESS_1)).toBe(true);
  });
  it('is NOT a rising edge for the same timestamp (an echo of the open press)', () => {
    expect(isRisingEdge(PRESS_1, PRESS_1)).toBe(false);
  });
  it('is a rising edge for a strictly-newer press', () => {
    expect(isRisingEdge(PRESS_1, PRESS_2)).toBe(true);
  });
  it('is NOT a rising edge for an older press (out-of-order delivery)', () => {
    expect(isRisingEdge(PRESS_2, PRESS_1)).toBe(false);
  });
  it('treats a malformed next timestamp as not-rising (never opens)', () => {
    expect(isRisingEdge(null, 'not-a-date')).toBe(false);
  });
});

describe('reduceDoorbellGlance — open + edge detection', () => {
  it('ignores a snapshot with no doorbell field', () => {
    const next = reduceDoorbellGlance(
      initialDoorbellGlanceState,
      snapshot(undefined, T0),
    );
    expect(next).toBe(initialDoorbellGlanceState);
    expect(next.open).toBe(false);
  });

  it('opens on the first press, focused on the doorbell by default', () => {
    const next = reduceDoorbellGlance(
      initialDoorbellGlanceState,
      snapshot(PRESS_1, T0),
    );
    expect(next.open).toBe(true);
    expect(next.lastRangAt).toBe(PRESS_1);
    expect(next.openedAt).toBe(T0);
    expect(next.focusCameraId).toBeNull();
  });

  it('does not re-open / reset for an echo of the same press', () => {
    const open = reduceDoorbellGlance(
      initialDoorbellGlanceState,
      snapshot(PRESS_1, T0),
    );
    const echo = reduceDoorbellGlance(open, snapshot(PRESS_1, T0 + 5000));
    expect(echo).toBe(open); // unchanged reference ⇒ no re-render churn
    expect(echo.openedAt).toBe(T0);
  });
});

describe('reduceDoorbellGlance — auto-close (3-min timer)', () => {
  it('closes when the autoClose matches the opening press', () => {
    const open = reduceDoorbellGlance(
      initialDoorbellGlanceState,
      snapshot(PRESS_1, T0),
    );
    const closed = reduceDoorbellGlance(open, { type: 'autoClose', openedAt: T0 });
    expect(closed.open).toBe(false);
    expect(closed.openedAt).toBeNull();
    // It remembers the press so the same one can't reopen it.
    expect(closed.lastRangAt).toBe(PRESS_1);
  });

  it('ignores a stale autoClose whose openedAt no longer matches (post-reset)', () => {
    const open = reduceDoorbellGlance(
      initialDoorbellGlanceState,
      snapshot(PRESS_1, T0),
    );
    // A second press resets the timer (bumps openedAt to T0 + 60s).
    const reset = reduceDoorbellGlance(open, snapshot(PRESS_2, T0 + 60_000));
    expect(reset.openedAt).toBe(T0 + 60_000);
    // The *first* timer fires late; its openedAt is stale ⇒ ignored.
    const afterStale = reduceDoorbellGlance(reset, { type: 'autoClose', openedAt: T0 });
    expect(afterStale.open).toBe(true);
    expect(afterStale).toBe(reset);
  });

  it('GLANCE_DURATION_MS is 3 minutes (decoupled from the ~15s pulse)', () => {
    expect(GLANCE_DURATION_MS).toBe(180_000);
  });
});

describe('reduceDoorbellGlance — reset on a new press while open', () => {
  it('a newer press while open re-arms the timer and refocuses the doorbell', () => {
    let s: DoorbellGlanceState = reduceDoorbellGlance(
      initialDoorbellGlanceState,
      snapshot(PRESS_1, T0),
    );
    // User picks a different camera mid-glance.
    s = reduceDoorbellGlance(s, { type: 'pick', cameraId: 'driveway' });
    expect(s.focusCameraId).toBe('driveway');
    // A second press resets: new openedAt, focus snaps back to the doorbell.
    s = reduceDoorbellGlance(s, snapshot(PRESS_2, T0 + 90_000));
    expect(s.open).toBe(true);
    expect(s.openedAt).toBe(T0 + 90_000);
    expect(s.lastRangAt).toBe(PRESS_2);
    expect(s.focusCameraId).toBeNull();
  });
});

describe('reduceDoorbellGlance — dismiss + pick', () => {
  it('dismiss closes but keeps lastRangAt so the same press cannot reopen', () => {
    const open = reduceDoorbellGlance(
      initialDoorbellGlanceState,
      snapshot(PRESS_1, T0),
    );
    const dismissed = reduceDoorbellGlance(open, { type: 'dismiss' });
    expect(dismissed.open).toBe(false);
    expect(dismissed.lastRangAt).toBe(PRESS_1);
    // An echo of the dismissed press does not reopen it.
    const echo = reduceDoorbellGlance(dismissed, snapshot(PRESS_1, T0 + 1000));
    expect(echo.open).toBe(false);
    // A genuinely-newer press *does* reopen it.
    const reopened = reduceDoorbellGlance(dismissed, snapshot(PRESS_2, T0 + 2000));
    expect(reopened.open).toBe(true);
  });

  it('pick is a no-op while closed', () => {
    const s = reduceDoorbellGlance(initialDoorbellGlanceState, {
      type: 'pick',
      cameraId: 'driveway',
    });
    expect(s).toBe(initialDoorbellGlanceState);
  });
});

describe('resolveGlanceCameras', () => {
  const cams: CameraView[] = [
    { id: 'front_door', name: 'Front door', doorbell: true, urlTemplate: 'd/{ts}?w={width}' },
    { id: 'driveway', name: 'Driveway', urlTemplate: 'dr/{ts}?w={width}' },
    { id: 'back_yard', name: 'Back yard', urlTemplate: 'b/{ts}?w={width}' },
  ];

  it('defaults the big frame to the doorbell camera; others are the picker', () => {
    const { focus, others } = resolveGlanceCameras(cams, null);
    expect(focus?.id).toBe('front_door');
    expect(others.map((c) => c.id)).toEqual(['driveway', 'back_yard']);
  });

  it('honors an explicit focus pick and excludes it from the picker', () => {
    const { focus, others } = resolveGlanceCameras(cams, 'driveway');
    expect(focus?.id).toBe('driveway');
    expect(others.map((c) => c.id)).toEqual(['front_door', 'back_yard']);
  });

  it('falls back to the first camera when none is flagged doorbell', () => {
    const noDoorbell = cams.map((c) => ({ ...c, doorbell: undefined }));
    const { focus } = resolveGlanceCameras(noDoorbell, null);
    expect(focus?.id).toBe('front_door');
  });

  it('falls back to the doorbell default when the picked id is unknown', () => {
    const { focus } = resolveGlanceCameras(cams, 'ghost_cam');
    expect(focus?.id).toBe('front_door');
  });

  it('returns null focus for an empty camera list', () => {
    expect(resolveGlanceCameras([], null)).toEqual({ focus: null, others: [] });
  });
});
