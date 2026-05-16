import {
  RestrictionCauseInput,
  RestrictionScope,
  mergeCause,
  recompute,
  removeCause,
} from './restriction-merge';

function missCause(
  expiry: string | null,
  goals: string[] | null,
  id = 'miss-1',
): RestrictionCauseInput {
  return {
    id,
    kind: 'miss',
    contributed_expires_at: expiry,
    contributed_remediation_goals: goals,
    parent_only_on_expiry: false,
    parent_only_on_remediation: false,
  };
}

function adminCause(id = 'admin-1'): RestrictionCauseInput {
  return {
    id,
    kind: 'admin',
    contributed_expires_at: null,
    contributed_remediation_goals: null,
    parent_only_on_expiry: true,
    parent_only_on_remediation: true,
  };
}

const games: RestrictionScope = 'games';
const internet: RestrictionScope = 'internet';
const user = 'user-bob';

describe('restriction merge engine (ADR-0004)', () => {
  describe('A — same-policy MAX expiry', () => {
    it('takes the later of two contributed expiries', () => {
      const a = missCause('2026-05-16T08:00:00Z', null, 'a');
      const b = missCause('2026-05-16T10:00:00Z', null, 'b');
      const state = recompute(games, user, [a, b])!;
      expect(state.effective_expires_at?.toISOString()).toBe(
        '2026-05-16T10:00:00.000Z',
      );
    });
  });

  describe('B — same-policy UNION remediation goals', () => {
    it('dedupes goal ids across Causes', () => {
      const a = missCause(null, ['g1', 'g2'], 'a');
      const b = missCause(null, ['g2', 'g3'], 'b');
      const state = recompute(games, user, [a, b])!;
      expect(state.effective_remediation_goals).toEqual(['g1', 'g2', 'g3']);
    });
  });

  describe('C — mixed-policy: parent-only on expiry wins', () => {
    it('null effective expiry when any Cause is parent-only-on-expiry', () => {
      const a = missCause('2026-05-16T08:00:00Z', ['g1'], 'a');
      const admin = adminCause('admin-1');
      const state = recompute(games, user, [a, admin])!;
      expect(state.effective_expires_at).toBeNull();
      // Remediation also clamped because admin is parent-only on both dims.
      expect(state.effective_remediation_goals).toEqual([]);
    });

    it('UNION still applies when only expiry is clamped', () => {
      const a = missCause('2026-05-16T08:00:00Z', ['g1'], 'a');
      const b: RestrictionCauseInput = {
        ...missCause('2026-05-16T09:00:00Z', ['g2'], 'b'),
        parent_only_on_expiry: true,
      };
      const state = recompute(games, user, [a, b])!;
      expect(state.effective_expires_at).toBeNull();
      expect(state.effective_remediation_goals).toEqual(['g1', 'g2']);
    });
  });

  describe('D — different scopes are independent', () => {
    it('mergeCause on a different scope produces a fresh Restriction', () => {
      const gamesState = mergeCause(
        null,
        user,
        games,
        missCause('2026-05-16T08:00:00Z', ['g1'], 'a'),
      );
      const internetState = mergeCause(
        null,
        user,
        internet,
        missCause('2026-05-16T10:00:00Z', ['g9'], 'b'),
      );
      expect(gamesState.scope).toBe('games');
      expect(internetState.scope).toBe('internet');
      expect(gamesState.effective_remediation_goals).toEqual(['g1']);
      expect(internetState.effective_remediation_goals).toEqual(['g9']);
    });
  });

  describe('E — removeCause recompute', () => {
    it('removing one Cause recomputes MAX and UNION over the remainder', () => {
      const a = missCause('2026-05-16T08:00:00Z', ['g1'], 'a');
      const b = missCause('2026-05-16T10:00:00Z', ['g2'], 'b');
      const c = missCause('2026-05-16T09:00:00Z', ['g3'], 'c');
      const before = recompute(games, user, [a, b, c])!;
      const after = removeCause(before, 'b')!;
      expect(after.effective_expires_at?.toISOString()).toBe(
        '2026-05-16T09:00:00.000Z',
      );
      expect(after.effective_remediation_goals.sort()).toEqual(['g1', 'g3']);
    });

    it('removing the parent-only Cause un-clamps the dimension', () => {
      const a = missCause('2026-05-16T08:00:00Z', ['g1'], 'a');
      const admin = adminCause('admin-1');
      const before = recompute(games, user, [a, admin])!;
      expect(before.effective_expires_at).toBeNull();
      const after = removeCause(before, 'admin-1')!;
      expect(after.effective_expires_at?.toISOString()).toBe(
        '2026-05-16T08:00:00.000Z',
      );
      expect(after.effective_remediation_goals).toEqual(['g1']);
    });
  });

  describe('F — remove-last-cause lifts', () => {
    it('returns null when no Causes remain', () => {
      const a = missCause('2026-05-16T08:00:00Z', ['g1'], 'a');
      const before = recompute(games, user, [a])!;
      const after = removeCause(before, 'a');
      expect(after).toBeNull();
    });
  });

  describe('mergeCause: first cause creates the Restriction', () => {
    it('builds a Restriction state with the single Cause', () => {
      const state = mergeCause(
        null,
        user,
        games,
        missCause('2026-05-16T08:00:00Z', ['g1'], 'a'),
      );
      expect(state.causes).toHaveLength(1);
      expect(state.effective_expires_at?.toISOString()).toBe(
        '2026-05-16T08:00:00.000Z',
      );
      expect(state.effective_remediation_goals).toEqual(['g1']);
    });
  });
});
