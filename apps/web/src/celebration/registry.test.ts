import { describe, expect, it, beforeEach } from 'vitest';
import {
  listVariants,
  pickById,
  pickRandom,
  pickVariant,
  registerVariant,
} from './registry';

describe('celebration registry', () => {
  beforeEach(() => {
    // The module-level registry array is module-private; tests can only add,
    // not reset. Each test registers ids unique to itself.
  });

  it('registers a variant and returns it via pickById', () => {
    registerVariant({
      id: 't-pick-a',
      name: 'A',
      render: ({ trackeeName, newBalance, dollarRate, onPickAnother }) => {
        // Touch the new context fields so the test guarantees the type
        // continues to expose them.
        void trackeeName;
        void newBalance;
        void dollarRate;
        void onPickAnother;
        return null;
      },
    });
    const v = pickById('t-pick-a');
    expect(v?.id).toBe('t-pick-a');
  });

  it('register is idempotent for the same id', () => {
    registerVariant({ id: 't-idem', name: 'A', render: () => null });
    registerVariant({ id: 't-idem', name: 'A2', render: () => null });
    const matches = listVariants().filter((v) => v.id === 't-idem');
    expect(matches).toHaveLength(1);
  });

  it('pickById returns null for an unknown id', () => {
    expect(pickById('does-not-exist')).toBeNull();
  });

  it('pickRandom returns a registered variant when the registry is non-empty', () => {
    registerVariant({ id: 't-rand', name: 'A', render: () => null });
    const v = pickRandom();
    expect(v).not.toBeNull();
    expect(listVariants().some((x) => x.id === v?.id)).toBe(true);
  });

  it('pickVariant prefers a pinned id when registered, otherwise falls back to random', () => {
    registerVariant({ id: 't-pin', name: 'A', render: () => null });
    expect(pickVariant('t-pin')?.id).toBe('t-pin');
    const fallback = pickVariant('not-registered');
    expect(fallback).not.toBeNull();
  });
});
