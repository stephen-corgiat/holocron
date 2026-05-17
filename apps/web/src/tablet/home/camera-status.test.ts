import { describe, it, expect } from 'vitest';
import {
  buildCameraSrc,
  deriveCameraStatus,
  initialCameraState,
  reduceCameraState,
  CAMERA_REFRESH_MS,
} from './camera-status';

describe('reduceCameraState', () => {
  it('a successful load records the good frame and clears the error streak', () => {
    let s = initialCameraState();
    s = reduceCameraState(s, { type: 'error', at: 0 });
    s = reduceCameraState(s, { type: 'load', src: 'a.jpg', at: 1000 });
    expect(s).toEqual({ lastGoodAt: 1000, lastGoodSrc: 'a.jpg', consecutiveErrors: 0 });
  });

  it('an error bumps the streak but never drops the last-good frame', () => {
    let s = reduceCameraState(initialCameraState(), {
      type: 'load',
      src: 'good.jpg',
      at: 1000,
    });
    s = reduceCameraState(s, { type: 'error', at: 2000 });
    s = reduceCameraState(s, { type: 'error', at: 3000 });
    expect(s.lastGoodSrc).toBe('good.jpg'); // last-good retained
    expect(s.lastGoodAt).toBe(1000);
    expect(s.consecutiveErrors).toBe(2);
  });
});

describe('deriveCameraStatus', () => {
  it('is fresh before any frame has loaded (initial loading window)', () => {
    expect(deriveCameraStatus(initialCameraState(), 0)).toBe('fresh');
  });

  it('is fresh right after a successful load', () => {
    const s = reduceCameraState(initialCameraState(), {
      type: 'load',
      src: 'a.jpg',
      at: 0,
    });
    expect(deriveCameraStatus(s, 0)).toBe('fresh');
    expect(deriveCameraStatus(s, 2 * CAMERA_REFRESH_MS)).toBe('fresh');
  });

  it('goes stale after >3 refresh cycles with no fresh load', () => {
    const s = reduceCameraState(initialCameraState(), {
      type: 'load',
      src: 'a.jpg',
      at: 0,
    });
    // exactly 3 cycles is still fresh; just past it is stale
    expect(deriveCameraStatus(s, 3 * CAMERA_REFRESH_MS)).toBe('fresh');
    expect(deriveCameraStatus(s, 3 * CAMERA_REFRESH_MS + 1)).toBe('stale');
  });

  it('goes offline after repeated errors, regardless of last-good age', () => {
    let s = reduceCameraState(initialCameraState(), {
      type: 'load',
      src: 'a.jpg',
      at: 0,
    });
    s = reduceCameraState(s, { type: 'error', at: 5000 });
    expect(deriveCameraStatus(s, 6000)).toBe('fresh'); // one error, still within window
    s = reduceCameraState(s, { type: 'error', at: 10000 });
    expect(deriveCameraStatus(s, 11000)).toBe('offline'); // two in a row ⇒ offline
  });

  it('a never-loaded camera that immediately fails repeatedly is offline', () => {
    let s = initialCameraState();
    s = reduceCameraState(s, { type: 'error', at: 100 });
    s = reduceCameraState(s, { type: 'error', at: 200 });
    expect(deriveCameraStatus(s, 300)).toBe('offline');
  });

  it('recovers to fresh once a frame loads again after errors', () => {
    let s = reduceCameraState(initialCameraState(), { type: 'error', at: 0 });
    s = reduceCameraState(s, { type: 'error', at: 100 });
    expect(deriveCameraStatus(s, 200)).toBe('offline');
    s = reduceCameraState(s, { type: 'load', src: 'b.jpg', at: 300 });
    expect(deriveCameraStatus(s, 300)).toBe('fresh');
  });

  it('honors custom thresholds', () => {
    const s = reduceCameraState(initialCameraState(), {
      type: 'load',
      src: 'a.jpg',
      at: 0,
    });
    expect(
      deriveCameraStatus(s, 1500, { refreshMs: 1000, staleAfterCycles: 1 }),
    ).toBe('stale');
  });
});

describe('buildCameraSrc', () => {
  it('substitutes {ts} and {width}', () => {
    expect(
      buildCameraSrc('http://ha/snap/{width}/cam/{ts}.jpg', 768, 42),
    ).toBe('http://ha/snap/768/cam/42.jpg');
  });

  it('substitutes a width query placeholder', () => {
    expect(
      buildCameraSrc('http://ha/cam/{ts}.jpg?width={width}&reason=periodic', 640, 7),
    ).toBe('http://ha/cam/7.jpg?width=640&reason=periodic');
  });

  it('appends a cache-busting ts when the template has no {ts}', () => {
    expect(buildCameraSrc('http://ha/cam.jpg', 768, 99)).toBe(
      'http://ha/cam.jpg?ts=99',
    );
    expect(buildCameraSrc('http://ha/cam.jpg?x=1', 768, 99)).toBe(
      'http://ha/cam.jpg?x=1&ts=99',
    );
  });

  it('replaces every occurrence of a placeholder', () => {
    expect(buildCameraSrc('{ts}-{ts}-{width}', 100, 5)).toBe('5-5-100');
  });
});
