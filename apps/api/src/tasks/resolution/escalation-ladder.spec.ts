import { Ladder, RestrictionSpec, reset, step } from './escalation-ladder';

const tier = (points: number, restriction: RestrictionSpec | null = null) => ({
  points,
  restriction,
});

describe('escalation-ladder.step', () => {
  it('returns the current tier payload and advances the position on a miss', () => {
    const ladder: Ladder = [tier(1), tier(5), tier(10)];
    const r = step(ladder, 1, 'miss');
    expect(r.payload).toEqual(tier(1));
    expect(r.position).toBe(2);
  });

  it('advances through the ladder one tier at a time', () => {
    const ladder: Ladder = [tier(1), tier(5), tier(10)];
    let pos = 1;
    const points: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = step(ladder, pos, 'miss');
      points.push(r.payload.points);
      pos = r.position;
    }
    expect(points).toEqual([1, 5, 10]);
    expect(pos).toBe(3);
  });

  it('repeats the last tier without advancing further ("and beyond")', () => {
    const ladder: Ladder = [tier(1), tier(5), tier(10)];
    let pos = 3;
    const points: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = step(ladder, pos, 'miss');
      points.push(r.payload.points);
      pos = r.position;
    }
    expect(points).toEqual([10, 10, 10, 10]);
    expect(pos).toBe(3);
  });

  it('clamps an out-of-range position to the last tier', () => {
    const ladder: Ladder = [tier(1), tier(5)];
    const r = step(ladder, 99, 'miss');
    expect(r.payload).toEqual(tier(5));
    expect(r.position).toBe(2);
  });

  it('handles a single-tier ladder by repeating it indefinitely', () => {
    const ladder: Ladder = [tier(1)];
    let pos = 1;
    for (let i = 0; i < 5; i++) {
      const r = step(ladder, pos, 'miss');
      expect(r.payload.points).toBe(1);
      expect(r.position).toBe(1);
      pos = r.position;
    }
  });

  it('does not advance the position on a clean outcome', () => {
    const ladder: Ladder = [tier(1), tier(5)];
    const r = step(ladder, 2, 'clean');
    expect(r.position).toBe(2);
  });

  it('passes through a tier with a restriction spec', () => {
    const ladder: Ladder = [tier(1), tier(5, { type: 'entertainment' })];
    const r = step(ladder, 2, 'miss');
    expect(r.payload.restriction).toEqual({ type: 'entertainment' });
  });

  it('throws on an empty ladder', () => {
    expect(() => step([], 1, 'miss')).toThrow();
  });
});

describe('escalation-ladder.reset', () => {
  it('always returns Tier 1', () => {
    expect(reset(1)).toBe(1);
    expect(reset(5)).toBe(1);
    expect(reset(99)).toBe(1);
  });
});
