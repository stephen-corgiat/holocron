import { describeHaError } from './ha-errors';

describe('describeHaError', () => {
  it('unwraps undici "fetch failed" to the underlying cause + code', () => {
    const cause = Object.assign(
      new Error('connect ECONNREFUSED 192.0.2.10:8123'),
      { code: 'ECONNREFUSED' },
    );
    const err = Object.assign(new TypeError('fetch failed'), { cause });
    expect(describeHaError(err)).toBe(
      'fetch failed ← connect ECONNREFUSED 192.0.2.10:8123 (ECONNREFUSED)',
    );
  });

  it('pulls the Error off a WS ErrorEvent-shaped object', () => {
    const ev = { type: 'error', error: new Error('socket hang up') };
    expect(describeHaError(ev)).toBe('socket hang up');
  });

  it('falls back to the event type when a WS error carries no detail', () => {
    expect(describeHaError({ type: 'error' })).toBe("'error' event (no detail)");
  });

  it('renders a plain Error and stops at a null cause', () => {
    expect(describeHaError(new Error('boom'))).toBe('boom');
  });

  it('survives a circular cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b') as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(describeHaError(a)).toBe('a ← b');
  });
});
