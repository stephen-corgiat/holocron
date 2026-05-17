import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useHouseholdTimeZone } from '../settings/SettingsProvider';
import {
  dottedDateInTz,
  dowInTz,
  dowLabelInTz,
  hourInTz,
  isoDateInTz,
  utcInstantInTz,
  wallClockInTz,
} from '../lib/datetime';
import { useSocket } from '../hooks/useSocket';
import { pickVariant } from '../celebration/registry';
// Side-effect registration of the built-in default variant.
import '../celebration/default-variant';
import '../tablet/tablet.css';
import {
  CatalogGoalView,
  CategoryView,
  OccurrenceBucket,
  OccurrenceView,
  RestrictionCauseView,
  RestrictionScope,
  TabletPresenceView,
  TabletRestrictionView,
  TrackeeView,
  TransactionView,
  categoriesApi,
  goalsApi,
  occurrencesApi,
  presenceApi,
  restrictionsApi,
  transactionsApi,
  usersApi,
} from '../auth/api';
import { TabletStatusBar } from '../tablet/components/TabletStatusBar';
import { TrackeeTabBar } from '../tablet/components/TrackeeTabBar';
import { Card, Pill, Chip, SectionLabel, Ring } from '../tablet/components/primitives';
import { Icon } from '../tablet/icons/Icon';
import { Glyph, GlyphName, HolocronLogo, isKnownGlyph } from '../tablet/icons/Glyph';
import { CashOutDialog } from '../tablet/components/CashOutDialog';
import { TierPickerDialog } from '../tablet/components/TierPickerDialog';
import { PresenceSuppressedBanner } from '../tablet/components/PresenceSuppressedBanner';
import { TransactionList } from '../components/TransactionList';
import { useHaSource } from '../tablet/home/useHaSource';
import { ViewSwitch, type Surface } from '../tablet/home/ViewSwitch';
import { HomeView } from '../tablet/home/HomeView';
import { HomeDock } from '../tablet/home/HomeDock';
import { useDoorbellGlance } from '../tablet/home/useDoorbellGlance';
import { TabletDoorbellGlance } from '../tablet/home/TabletDoorbellGlance';

type View = 'routine' | 'goals' | 'favorites' | 'points';

function StarIcon({
  size = 14,
  filled = false,
  stroke = 2.2,
}: {
  size?: number;
  filled?: boolean;
  stroke?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z" />
    </svg>
  );
}

function PinIcon({
  size = 12,
  stroke = 2.4,
}: {
  size?: number;
  stroke?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3h6l-1 6 4 3v2h-6v6l-1 1-1-1v-6H4v-2l4-3Z" />
    </svg>
  );
}

export function TabletPage() {
  const { session } = useAuth();
  const tz = useHouseholdTimeZone();
  const tabletToken = session.kind === 'tablet' ? session.token : null;
  const { status, on } = useSocket(tabletToken);

  // Optional home surface (HA controls and/or Scrypted cameras). Hidden
  // entirely only when BOTH are unconfigured (the both-off cascade).
  const {
    snapshot: haSnapshot,
    enabled: haEnabled,
    haControlsEnabled,
    lightsOn: haLightsOn,
    cameras: haCameras,
    snapshotWidth: haSnapshotWidth,
    toggle: haToggle,
    nudgeClimate: haNudgeClimate,
    setFan: haSetFan,
    pressButton: haPressButton,
    setBoolean: haSetBoolean,
  } = useHaSource(tabletToken, on);
  const [surface, setSurface] = useState<Surface>('routine');
  const [haBusy, setHaBusy] = useState<Set<string>>(() => new Set());
  // Run an HA command with the entity marked busy and a fail-soft catch — HA
  // being unhappy can never block the tablet (commands toast-fail silently).
  const runHaCommand = useCallback(
    async (entityId: string, op: () => Promise<void>) => {
      setHaBusy((prev) => new Set(prev).add(entityId));
      try {
        await op();
      } catch {
        // fail soft
      } finally {
        setHaBusy((prev) => {
          const next = new Set(prev);
          next.delete(entityId);
          return next;
        });
      }
    },
    [],
  );
  const handleHaToggle = useCallback(
    (entityId: string, nextOn: boolean) =>
      runHaCommand(entityId, () => haToggle(entityId, nextOn)),
    [runHaCommand, haToggle],
  );
  const handleHaNudgeClimate = useCallback(
    (entityId: string, dir: 1 | -1) =>
      runHaCommand(entityId, () => haNudgeClimate(entityId, dir)),
    [runHaCommand, haNudgeClimate],
  );
  const handleHaSetFan = useCallback(
    (entityId: string, state: 'off' | 'low' | 'high') =>
      runHaCommand(entityId, () => haSetFan(entityId, state)),
    [runHaCommand, haSetFan],
  );
  const handleHaPressButton = useCallback(
    (entityId: string) =>
      runHaCommand(entityId, () => haPressButton(entityId)),
    [runHaCommand, haPressButton],
  );
  const handleHaSetBoolean = useCallback(
    (entityId: string, nextOn: boolean) =>
      runHaCommand(entityId, () => haSetBoolean(entityId, nextOn)),
    [runHaCommand, haSetBoolean],
  );

  // Doorbell glance (combined-effort payoff): an HA press
  // event auto-surfaces the front-door camera. Gated on BOTH integrations —
  // HA controls present (so a `doorbell.rangAt` can ever arrive) AND at least
  // one Scrypted camera (so there's a frame to show). With only one, the
  // overlay never opens; steady polling / controls still work alone.
  const doorbellGated = haControlsEnabled && haCameras.length > 0;
  const doorbell = useDoorbellGlance(
    haSnapshot?.doorbell?.rangAt,
    doorbellGated,
  );

  const [trackees, setTrackees] = useState<TrackeeView[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(
    () => readLastActiveId(),
  );
  const setActiveId: typeof setActiveIdState = (value) => {
    setActiveIdState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      if (typeof window !== 'undefined') {
        try {
          if (next) localStorage.setItem('holocron.lastActiveTab', next);
          else localStorage.removeItem('holocron.lastActiveTab');
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  };
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<OccurrenceView[]>([]);
  const [upNext, setUpNext] = useState<OccurrenceView[]>([]);
  const [occError, setOccError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [rate, setRate] = useState<number>(0.1);
  const [pendingCashOut, setPendingCashOut] = useState<boolean>(false);
  const [pendingComplete, setPendingComplete] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>('routine');
  const [activeRestrictions, setActiveRestrictions] =
    useState<TabletRestrictionView | null>(null);
  const [restrictedUserIds, setRestrictedUserIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [awayUserIds, setAwayUserIds] = useState<Set<string>>(() => new Set());
  const [askParentBusy, setAskParentBusy] = useState<RestrictionScope | null>(
    null,
  );
  const [askParentDone, setAskParentDone] = useState<Set<RestrictionScope>>(
    () => new Set(),
  );
  const [catalog, setCatalog] = useState<CatalogGoalView[]>([]);
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [pendingGoal, setPendingGoal] = useState<Set<string>>(new Set());
  const [tierGoal, setTierGoal] = useState<CatalogGoalView | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [inProgressGoals, setInProgressGoals] = useState<
    { goal_id: string; started_at: string }[]
  >([]);
  const [recentGoalIds, setRecentGoalIds] = useState<string[]>([]);
  const [goalSearch, setGoalSearch] = useState<string>('');
  const [audibleBanner, setAudibleBanner] = useState<string | null>(null);
  const [presence, setPresence] = useState<TabletPresenceView | null>(null);
  const [showCashOut, setShowCashOut] = useState(false);
  const [cashOutBusy, setCashOutBusy] = useState(false);
  const [cashOutError, setCashOutError] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{
    key: number;
    variantId: string | null;
    goalId: string;
    goalName: string;
    amount: number;
  } | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const handle = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(handle);
  }, []);

  const refreshRoster = useCallback(async () => {
    if (!tabletToken) return;
    try {
      const { trackees: next } = await usersApi.roster(tabletToken);
      setTrackees(next);
      setRosterError(null);
      setActiveId((prev) => {
        if (prev && next.some((t) => t.id === prev)) return prev;
        const firstRestrictable = next.find((t) => t.is_restrictable);
        return firstRestrictable?.id ?? next[0]?.id ?? null;
      });
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : 'roster fetch failed');
    }
  }, [tabletToken]);

  useEffect(() => {
    void refreshRoster();
  }, [refreshRoster]);

  useEffect(() => {
    const off = on('users:roster_changed', () => {
      void refreshRoster();
    });
    return off;
  }, [on, refreshRoster]);

  const refreshOccurrences = useCallback(async () => {
    if (!tabletToken || !activeId) {
      setOccurrences([]);
      setUpNext([]);
      return;
    }
    try {
      const [{ occurrences: next }, { occurrences: nextUp }] = await Promise.all([
        occurrencesApi.forTrackee(tabletToken, activeId),
        occurrencesApi.upNext(tabletToken, activeId),
      ]);
      setOccurrences(next);
      setUpNext(nextUp);
      setOccError(null);
    } catch (err) {
      setOccError(err instanceof Error ? err.message : 'failed to load tasks');
      setOccurrences([]);
      setUpNext([]);
    }
  }, [tabletToken, activeId]);

  useEffect(() => {
    void refreshOccurrences();
  }, [refreshOccurrences]);

  useEffect(() => {
    const off = on('tasks:changed', () => void refreshOccurrences());
    return off;
  }, [on, refreshOccurrences]);

  const refreshRestrictions = useCallback(async () => {
    if (!tabletToken || !activeId) {
      setActiveRestrictions(null);
      return;
    }
    try {
      const next = await restrictionsApi.forTrackee(tabletToken, activeId);
      setActiveRestrictions(next);
    } catch {
      setActiveRestrictions(null);
    }
  }, [tabletToken, activeId]);

  const refreshActiveRestrictedUsers = useCallback(async () => {
    if (!tabletToken) return;
    try {
      const { users: rows } = await restrictionsApi.activeUsers(tabletToken);
      setRestrictedUserIds(new Set(rows.map((r) => r.user_id)));
    } catch {
      setRestrictedUserIds(new Set());
    }
  }, [tabletToken]);

  useEffect(() => {
    void refreshRestrictions();
  }, [refreshRestrictions]);

  useEffect(() => {
    void refreshActiveRestrictedUsers();
  }, [refreshActiveRestrictedUsers]);

  useEffect(() => {
    const off = on('restrictions:changed', () => {
      void refreshRestrictions();
      void refreshActiveRestrictedUsers();
    });
    return off;
  }, [on, refreshRestrictions, refreshActiveRestrictedUsers]);

  const askParent = async (scope: RestrictionScope) => {
    if (!tabletToken || !activeId) return;
    setAskParentBusy(scope);
    try {
      await restrictionsApi.askParent(tabletToken, {
        user_id: activeId,
        scope,
      });
      setAskParentDone((prev) => new Set(prev).add(scope));
    } catch (err) {
      setOccError(err instanceof Error ? err.message : 'ask-parent failed');
    } finally {
      setAskParentBusy(null);
    }
  };

  const refreshBalance = useCallback(async () => {
    if (!tabletToken || !activeId) {
      setBalance(null);
      return;
    }
    try {
      const next = await transactionsApi.balance(tabletToken, activeId);
      setBalance(next.balance);
      setRate(next.cash_out_rate);
      setPendingCashOut(next.pending_cash_out);
    } catch {
      setBalance(null);
    }
  }, [tabletToken, activeId]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  useEffect(() => {
    const offTasks = on('tasks:changed', () => void refreshBalance());
    const offTxn = on('transactions:changed', () => void refreshBalance());
    return () => {
      offTasks();
      offTxn();
    };
  }, [on, refreshBalance]);

  const refreshCatalog = useCallback(async () => {
    if (!tabletToken || !activeId) {
      setCatalog([]);
      setCategories([]);
      return;
    }
    try {
      const [{ goals }, { categories: nextCategories }] = await Promise.all([
        goalsApi.catalog(tabletToken, activeId),
        categoriesApi.list(tabletToken),
      ]);
      setCatalog(goals);
      setCategories(nextCategories);
      setGoalError(null);
    } catch (err) {
      setGoalError(err instanceof Error ? err.message : 'failed to load goals');
    }
  }, [tabletToken, activeId]);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  const refreshFavorites = useCallback(async () => {
    if (!tabletToken || !activeId) {
      setFavorites(new Set());
      return;
    }
    try {
      const { goal_ids } = await goalsApi.listFavorites(tabletToken, activeId);
      setFavorites(new Set(goal_ids));
    } catch {
      setFavorites(new Set());
    }
  }, [tabletToken, activeId]);

  const refreshInProgress = useCallback(async () => {
    if (!tabletToken || !activeId) {
      setInProgressGoals([]);
      return;
    }
    try {
      const { items } = await goalsApi.listInProgress(tabletToken, activeId);
      setInProgressGoals(items);
    } catch {
      setInProgressGoals([]);
    }
  }, [tabletToken, activeId]);

  const refreshRecentCompletions = useCallback(async () => {
    if (!tabletToken || !activeId) {
      setRecentGoalIds([]);
      return;
    }
    try {
      const { goal_ids } = await goalsApi.recentCompletions(
        tabletToken,
        activeId,
        3,
      );
      setRecentGoalIds(goal_ids);
    } catch {
      setRecentGoalIds([]);
    }
  }, [tabletToken, activeId]);

  useEffect(() => {
    void refreshFavorites();
    void refreshInProgress();
    void refreshRecentCompletions();
  }, [refreshFavorites, refreshInProgress, refreshRecentCompletions]);

  // Reset transient UI state when switching trackees.
  useEffect(() => {
    setGoalSearch('');
  }, [activeId]);

  const refreshPresence = useCallback(async () => {
    if (!tabletToken || !activeId) {
      setPresence(null);
      return;
    }
    try {
      const next = await presenceApi.forTrackee(tabletToken, activeId);
      setPresence(next);
    } catch {
      setPresence(null);
    }
  }, [tabletToken, activeId]);

  useEffect(() => {
    void refreshPresence();
  }, [refreshPresence]);

  useEffect(() => {
    const id = setInterval(() => void refreshPresence(), 60_000);
    return () => clearInterval(id);
  }, [refreshPresence]);

  // Refresh the away-set for every trackee so the tab strip can mark away
  // peers without us needing a presence query per tab on tab switch.
  useEffect(() => {
    if (!tabletToken || trackees.length === 0) {
      setAwayUserIds(new Set());
      return;
    }
    let cancelled = false;
    void Promise.all(
      trackees.map((t) =>
        presenceApi.forTrackee(tabletToken, t.id).catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      const away = new Set<string>();
      results.forEach((p, i) => {
        if (p && !p.is_home) away.add(trackees[i].id);
      });
      setAwayUserIds(away);
    });
    return () => {
      cancelled = true;
    };
  }, [tabletToken, trackees]);

  useEffect(() => {
    const off = on('goals:completed', (payload) => {
      const evt = payload as {
        user_id: string;
        goal_id: string;
        goal_name: string;
        amount: number;
        celebration_variant_id: string | null;
      };
      if (!evt || evt.user_id !== activeId) return;
      setCelebration({
        key: Date.now(),
        variantId: evt.celebration_variant_id,
        goalId: evt.goal_id,
        goalName: evt.goal_name,
        amount: evt.amount,
      });
    });
    return off;
  }, [on, activeId]);

  useEffect(() => {
    const off = on('audible_warning:fire', () => {
      setAudibleBanner('Routine check — finish your tasks!');
      void playChime();
      setTimeout(() => setAudibleBanner(null), 12_000);
    });
    return off;
  }, [on]);

  useEffect(() => {
    const unlock = () => {
      void ensureAudioContext();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    const offGoals = on('goals:changed', () => void refreshCatalog());
    const offTxn = on('transactions:changed', () => void refreshCatalog());
    const offUser = on('goals:user-changed', (payload) => {
      const evt = payload as { user_id?: string } | undefined;
      if (!evt || evt.user_id !== activeId) return;
      void refreshFavorites();
      void refreshInProgress();
      void refreshRecentCompletions();
    });
    return () => {
      offGoals();
      offTxn();
      offUser();
    };
  }, [
    on,
    activeId,
    refreshCatalog,
    refreshFavorites,
    refreshInProgress,
    refreshRecentCompletions,
  ]);

  const completeGoal = async (
    goalId: string,
    tierValue?: number,
    restrictionId?: string,
  ) => {
    if (!tabletToken || !activeId) return;
    setPendingGoal((prev) => new Set(prev).add(goalId));
    try {
      await goalsApi.complete(
        tabletToken,
        goalId,
        activeId,
        tierValue,
        restrictionId,
      );
      await Promise.all([
        refreshCatalog(),
        refreshBalance(),
        refreshRestrictions(),
        refreshInProgress(),
        refreshRecentCompletions(),
      ]);
    } catch (err) {
      setGoalError(err instanceof Error ? err.message : 'goal completion failed');
    } finally {
      setPendingGoal((prev) => {
        const next = new Set(prev);
        next.delete(goalId);
        return next;
      });
    }
  };

  const toggleFavorite = async (goalId: string) => {
    if (!tabletToken || !activeId) return;
    const isFav = favorites.has(goalId);
    // optimistic
    setFavorites((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
    try {
      await goalsApi.setFavorite(tabletToken, goalId, activeId, !isFav);
    } catch (err) {
      setGoalError(err instanceof Error ? err.message : 'favorite update failed');
      void refreshFavorites();
    }
  };

  const addInProgress = async (goalId: string) => {
    if (!tabletToken || !activeId) return;
    try {
      await goalsApi.addInProgress(tabletToken, goalId, activeId);
      await refreshInProgress();
    } catch (err) {
      setGoalError(err instanceof Error ? err.message : 'mark in-progress failed');
    }
  };

  const removeInProgressGoal = async (goalId: string) => {
    if (!tabletToken || !activeId) return;
    try {
      await goalsApi.removeInProgress(tabletToken, goalId, activeId);
      await refreshInProgress();
    } catch (err) {
      setGoalError(err instanceof Error ? err.message : 'clear in-progress failed');
    }
  };

  const markComplete = async (occId: string) => {
    if (!tabletToken) return;
    setPendingComplete((prev) => new Set(prev).add(occId));
    try {
      await occurrencesApi.complete(tabletToken, occId);
      await refreshOccurrences();
      await refreshBalance();
    } catch (err) {
      setOccError(err instanceof Error ? err.message : 'mark-done failed');
    } finally {
      setPendingComplete((prev) => {
        const next = new Set(prev);
        next.delete(occId);
        return next;
      });
    }
  };

  const lateComplete = async (occId: string) => {
    if (!tabletToken) return;
    setPendingComplete((prev) => new Set(prev).add(occId));
    try {
      await occurrencesApi.lateComplete(tabletToken, occId);
      await refreshOccurrences();
      await refreshBalance();
    } catch (err) {
      setOccError(err instanceof Error ? err.message : 'late-complete failed');
    } finally {
      setPendingComplete((prev) => {
        const next = new Set(prev);
        next.delete(occId);
        return next;
      });
    }
  };

  const active = trackees.find((t) => t.id === activeId) ?? null;
  const adminTrackees = useMemo(
    () => trackees.filter((t) => t.is_admin && t.deactivated_at === null),
    [trackees],
  );
  const inputDisabled = status !== 'connected';

  const inProgressIds = useMemo(
    () => new Set(inProgressGoals.map((r) => r.goal_id)),
    [inProgressGoals],
  );
  const inProgressEntries = useMemo(() => {
    const byId = new Map(catalog.map((g) => [g.id, g]));
    return inProgressGoals
      .map((row) => {
        const goal = byId.get(row.goal_id);
        if (!goal) return null;
        return { goal, started_at: row.started_at };
      })
      .filter((e): e is { goal: CatalogGoalView; started_at: string } => !!e);
  }, [inProgressGoals, catalog]);
  const recentEntries = useMemo(() => {
    const byId = new Map(catalog.map((g) => [g.id, g]));
    return recentGoalIds
      .map((id) => byId.get(id))
      .filter((g): g is CatalogGoalView => !!g);
  }, [recentGoalIds, catalog]);

  const buckets = useMemo(
    () => groupByBucket(occurrences, now),
    [occurrences, now],
  );

  const activeStreak = active?.current_streak ?? 0;
  const allTasks = useMemo(
    () => occurrences.filter((o) => o.task_kind !== 'reminder'),
    [occurrences],
  );
  const doneTasks = allTasks.filter(
    (o) => o.status === 'complete' || o.status === 'pending_review',
  ).length;
  const ringPct = allTasks.length === 0 ? 0 : doneTasks / allTasks.length;
  const upNextOccurrence = useMemo(
    () =>
      occurrences.find(
        (o) =>
          o.status !== 'complete' &&
          o.status !== 'pending_review' &&
          o.status !== 'excused' &&
          !o.presence_suppressed &&
          o.task_kind !== 'reminder',
      ) ?? null,
    [occurrences],
  );

  return (
    <div className={`tb-root ${inputDisabled ? 'is-disconnected' : ''}`}>
      {celebration &&
        (() => {
          const variant = pickVariant(celebration.variantId);
          if (!variant) return null;
          return (
            <div key={celebration.key}>
              {variant.render({
                goalId: celebration.goalId,
                goalName: celebration.goalName,
                amount: celebration.amount,
                trackeeName: active?.display_name ?? '',
                newBalance: balance ?? 0,
                dollarRate: rate,
                onPickAnother: () => setView('goals'),
                onDone: () => {
                  setView('routine');
                  setCelebration(null);
                },
              })}
            </div>
          );
        })()}

      <TabletStatusBar
        time={formatClock(now, tz)}
        date={formatStatusDate(now, tz)}
        status={
          status === 'connected'
            ? 'connected'
            : status === 'connecting'
              ? 'connecting'
              : 'disconnected'
        }
      />

      {inputDisabled && (
        <div className="tb-disconnected-banner" role="status">
          ⚠ Disconnected — input disabled until the connection returns.
        </div>
      )}
      {audibleBanner && (
        <div
          className="tb-audible-banner"
          role="alert"
          onClick={() => setAudibleBanner(null)}
        >
          🔔 {audibleBanner}
        </div>
      )}

      <header className="tb-header">
        <div className="tb-header-left">
          <HolocronLogo size={30} />
          <TrackeeTabBar
            trackees={trackees}
            activeId={activeId}
            onPick={setActiveId}
            restrictedUserIds={restrictedUserIds}
            awayUserIds={awayUserIds}
            disabled={inputDisabled}
          />
          {haEnabled && (
            <ViewSwitch surface={surface} onChange={setSurface} />
          )}
        </div>
        {active && (
          <div className="tb-header-center">
            <div className="tb-header-title">
              {greetingFor(now, tz)}, {active.display_name}
            </div>
            <div className="tb-header-sub">{formatHeaderDate(now, tz)}</div>
          </div>
        )}
        <div className="tb-header-right">
          {haEnabled && haControlsEnabled && (
            <Pill tone={haSnapshot?.status === 'ok' ? 'primary' : 'danger'}>
              <Icon
                name={haSnapshot?.status === 'ok' ? 'home' : 'nosignal'}
                size={12}
                stroke={2.2}
              />
              {haSnapshot?.status === 'ok' ? 'HOUSE · LINKED' : 'HOUSE · DEGRADED'}
            </Pill>
          )}
          {active && activeStreak > 0 && (
            <Pill tone="warn">
              <Icon name="fire" size={13} stroke={2.2} /> {activeStreak}-day routine streak
            </Pill>
          )}
          {active && (
            <span className="tb-points-chip" aria-label="points balance">
              <Icon name="coin" size={15} stroke={2.4} />
              {balance ?? 0} PTS
            </span>
          )}
        </div>
      </header>

      {rosterError && <p className="tb-error">{rosterError}</p>}

      {haEnabled && surface === 'home' && haSnapshot ? (
        <HomeView
          snapshot={haSnapshot}
          onToggle={handleHaToggle}
          onNudgeClimate={handleHaNudgeClimate}
          onSetFan={handleHaSetFan}
          onPressButton={handleHaPressButton}
          onSetBoolean={handleHaSetBoolean}
          busy={haBusy}
          surfaceActive={surface === 'home'}
        />
      ) : !active ? (
        <div className="tb-empty">Waiting for an active Trackee…</div>
      ) : (
        <>
          <div className="tb-viewbar">
            <button
              type="button"
              className={`tb-viewbtn ${view === 'routine' ? 'is-on' : ''}`}
              onClick={() => setView('routine')}
            >
              Routine
            </button>
            <button
              type="button"
              className={`tb-viewbtn ${view === 'goals' ? 'is-on' : ''}`}
              onClick={() => setView('goals')}
            >
              Pick a goal
            </button>
            <button
              type="button"
              className={`tb-viewbtn ${view === 'favorites' ? 'is-on' : ''}`}
              onClick={() => setView('favorites')}
            >
              Favorites
            </button>
            <button
              type="button"
              className={`tb-viewbtn ${view === 'points' ? 'is-on' : ''}`}
              onClick={() => setView('points')}
            >
              Points
            </button>
          </div>

          {view === 'routine' &&
            (presence && !presence.is_home ? (
              <PresenceSuppressedBanner
                trackee={active}
                nextReturn={presence.next_vacation?.end ?? null}
                vacationLabel={presence.next_vacation?.label ?? null}
                otherTrackees={trackees.filter(
                  (t) =>
                    t.id !== active.id &&
                    !awayUserIds.has(t.id) &&
                    t.deactivated_at === null,
                )}
                onPickOther={setActiveId}
              />
            ) : (
              <RoutineBoard
                trackeeName={active.display_name}
                allCount={allTasks.length}
                doneCount={doneTasks}
                ringPct={ringPct}
                streak={activeStreak}
                upNext={upNextOccurrence}
                catalogCount={catalog.length}
                nextAway={presence?.next_vacation ?? null}
                buckets={buckets}
                onMarkComplete={markComplete}
                onLateComplete={lateComplete}
                pending={pendingComplete}
                now={now}
                occError={occError}
                onPickGoalsView={() => setView('goals')}
                activeRestrictions={activeRestrictions}
                onAskParent={askParent}
                askParentBusy={askParentBusy}
                askParentDone={askParentDone}
                catalog={catalog}
                onCompleteGoal={completeGoal}
                pendingGoal={pendingGoal}
                upNextRail={upNext}
                inProgressEntries={inProgressEntries}
                recentEntries={recentEntries}
                onPickTier={setTierGoal}
                onAddInProgress={addInProgress}
                onRemoveInProgress={removeInProgressGoal}
              />
            ))}

          {view === 'points' && (
            <PointsHistory
              trackeeName={active.display_name}
              userId={active.id}
              tabletToken={tabletToken!}
              balance={balance ?? 0}
              rate={rate}
              pendingCashOut={pendingCashOut}
              streak={activeStreak}
              admins={adminTrackees}
              onBack={() => setView('routine')}
              onOpenCashOut={() => {
                setCashOutError(null);
                setShowCashOut(true);
              }}
            />
          )}

          {view === 'goals' && (
            <GoalsCatalog
              trackeeName={active.display_name}
              catalog={catalog}
              categories={categories}
              categoryFilter={categoryFilter}
              onPickCategory={setCategoryFilter}
              onComplete={completeGoal}
              pending={pendingGoal}
              error={goalError}
              onBack={() => setView('routine')}
              favorites={favorites}
              inProgressIds={inProgressIds}
              inProgressCount={inProgressGoals.length}
              onToggleFavorite={toggleFavorite}
              onAddInProgress={addInProgress}
              onRemoveInProgress={removeInProgressGoal}
              search={goalSearch}
              onSearchChange={setGoalSearch}
              onOpenFavorites={() => setView('favorites')}
              onPickTier={setTierGoal}
            />
          )}

          {view === 'favorites' && (
            <GoalsCatalog
              trackeeName={active.display_name}
              catalog={catalog}
              categories={categories}
              categoryFilter={null}
              onPickCategory={() => {}}
              onComplete={completeGoal}
              pending={pendingGoal}
              error={goalError}
              onBack={() => setView('routine')}
              favorites={favorites}
              inProgressIds={inProgressIds}
              inProgressCount={inProgressGoals.length}
              onToggleFavorite={toggleFavorite}
              onAddInProgress={addInProgress}
              onRemoveInProgress={removeInProgressGoal}
              search={goalSearch}
              onSearchChange={setGoalSearch}
              onOpenFavorites={() => setView('goals')}
              onPickTier={setTierGoal}
              favoritesOnly
            />
          )}
        </>
      )}

      {haEnabled && surface === 'routine' && haSnapshot && (
        <HomeDock
          snapshot={haSnapshot}
          lightsOn={haLightsOn}
          onNudgeClimate={handleHaNudgeClimate}
          onSetFan={handleHaSetFan}
          filmstripActive={surface === 'routine'}
          onOpenHome={() => setSurface('home')}
        />
      )}

      <CashOutDialog
        open={showCashOut}
        onClose={() => setShowCashOut(false)}
        balance={Math.max(0, balance ?? 0)}
        rate={rate}
        admins={adminTrackees}
        busy={cashOutBusy}
        error={cashOutError}
        onConfirm={async (amount) => {
          if (!tabletToken || !active) return;
          setCashOutBusy(true);
          setCashOutError(null);
          try {
            await transactionsApi.createCashOutRequest(
              tabletToken,
              active.id,
              amount,
            );
            setShowCashOut(false);
            await refreshBalance();
          } catch (err) {
            setCashOutError(
              err instanceof Error ? err.message : 'cash-out request failed',
            );
          } finally {
            setCashOutBusy(false);
          }
        }}
      />

      <TierPickerDialog
        open={tierGoal !== null}
        onClose={() => setTierGoal(null)}
        goal={tierGoal}
        balance={balance ?? 0}
        rate={rate}
        busy={tierGoal !== null && pendingGoal.has(tierGoal.id)}
        error={goalError}
        onConfirm={async (tier) => {
          if (!tierGoal) return;
          await completeGoal(tierGoal.id, tier);
          setTierGoal(null);
        }}
      />

      {doorbell.open && (
        <TabletDoorbellGlance
          cameras={haCameras}
          width={haSnapshotWidth}
          rangAt={doorbell.rangAt}
          focusCameraId={doorbell.focusCameraId}
          tz={tz}
          onPick={doorbell.pick}
          onDismiss={doorbell.dismiss}
        />
      )}

    </div>
  );
}

const BUCKET_ORDER: OccurrenceBucket[] = ['morning', 'after_school', 'evening'];

const BUCKET_LABELS: Record<OccurrenceBucket, string> = {
  morning: 'Morning',
  after_school: 'After school',
  evening: 'Evening',
};

const BUCKET_GLYPHS: Record<OccurrenceBucket, GlyphName> = {
  morning: 'sun',
  after_school: 'book',
  evening: 'moon',
};

const BUCKET_TIMES: Record<OccurrenceBucket, string> = {
  morning: '06:00 — 09:00',
  after_school: '15:00 — 18:00',
  evening: '18:00 — 21:00',
};

type GroupedOccurrence = OccurrenceView & { clientAutoComplete: boolean };

function groupByBucket(
  occurrences: OccurrenceView[],
  now: Date,
): Record<OccurrenceBucket, GroupedOccurrence[]> {
  const out: Record<OccurrenceBucket, GroupedOccurrence[]> = {
    morning: [],
    after_school: [],
    evening: [],
  };
  for (const o of occurrences) {
    const scheduled = new Date(o.scheduled_at);
    const clientAutoComplete =
      o.task_kind === 'reminder' &&
      (o.auto_complete || scheduled.getTime() <= now.getTime());
    out[o.bucket].push({ ...o, clientAutoComplete });
  }
  for (const bucket of BUCKET_ORDER) {
    out[bucket].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  }
  return out;
}

interface RoutineBoardProps {
  trackeeName: string;
  allCount: number;
  doneCount: number;
  ringPct: number;
  streak: number;
  upNext: OccurrenceView | null;
  catalogCount: number;
  nextAway: { start: string; end: string; label: string } | null;
  buckets: Record<OccurrenceBucket, GroupedOccurrence[]>;
  onMarkComplete: (id: string) => void;
  onLateComplete: (id: string) => void;
  pending: Set<string>;
  now: Date;
  occError: string | null;
  onPickGoalsView: () => void;
  activeRestrictions: TabletRestrictionView | null;
  onAskParent: (scope: RestrictionScope) => void;
  askParentBusy: RestrictionScope | null;
  askParentDone: Set<RestrictionScope>;
  catalog: CatalogGoalView[];
  onCompleteGoal: (
    goalId: string,
    tierValue?: number,
    restrictionId?: string,
  ) => void;
  pendingGoal: Set<string>;
  upNextRail: OccurrenceView[];
  inProgressEntries: { goal: CatalogGoalView; started_at: string }[];
  recentEntries: CatalogGoalView[];
  onPickTier: (goal: CatalogGoalView) => void;
  onAddInProgress: (goalId: string) => void;
  onRemoveInProgress: (goalId: string) => void;
}

function RoutineBoard(props: RoutineBoardProps) {
  const tz = useHouseholdTimeZone();
  const {
    allCount,
    doneCount,
    ringPct,
    streak,
    upNext,
    catalogCount,
    nextAway,
    buckets,
    onMarkComplete,
    onLateComplete,
    pending,
    now,
    occError,
    onPickGoalsView,
    activeRestrictions,
    catalog,
    onCompleteGoal,
    pendingGoal,
    onAskParent,
    askParentBusy,
    askParentDone,
    upNextRail,
    inProgressEntries,
    recentEntries,
    onPickTier,
    onAddInProgress,
    onRemoveInProgress,
  } = props;
  const restrictionActive =
    activeRestrictions && activeRestrictions.active.length > 0;
  const nextStreak = streak + 1;
  const occurrencesById = useMemo(() => {
    const map = new Map<string, GroupedOccurrence>();
    for (const list of Object.values(buckets)) {
      for (const o of list) map.set(o.id, o);
    }
    return map;
  }, [buckets]);

  return (
    <div className="tb-body cols-2">
      <div className="tb-rail">
        <Card>
          <SectionLabel>Today's routine</SectionLabel>
          <div className="tb-ring-row">
            <Ring size={88} stroke={9} value={ringPct}>
              <div style={{ textAlign: 'center' }}>
                <div className="tb-ring-num">
                  {doneCount}
                  <small>/{allCount}</small>
                </div>
                <div className="tb-ring-label">DONE</div>
              </div>
            </Ring>
            <div className="tb-ring-copy">
              <div className="tb-ring-copy-h">
                {ringPct >= 1
                  ? 'All done.'
                  : ringPct >= 0.5
                    ? 'Halfway through.'
                    : 'Just getting started.'}
              </div>
              <div className="tb-ring-copy-p">
                Finish today to advance your streak to{' '}
                <b className="warn">{nextStreak}</b> and earn the{' '}
                <b className="primary">+10</b> bonus.
              </div>
            </div>
          </div>
        </Card>

        {upNext && (
          <Card>
            <SectionLabel>Up next</SectionLabel>
            <div className="tb-up-next">
              <div className="tb-up-next-icon">
                <Glyph
                  name={upNext.task_icon ?? 'spark'}
                  size={22}
                  color="currentColor"
                />
              </div>
              <div style={{ flex: 1 }}>
                <div className="tb-up-next-title">{upNext.task_name}</div>
                <div className="tb-up-next-meta">
                  +{upNext.task_points} PTS · {upNext.display_time}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="tb-cta"
              style={{ marginTop: 12 }}
              onClick={() => onMarkComplete(upNext.id)}
              disabled={pending.has(upNext.id)}
            >
              Mark complete
            </button>
          </Card>
        )}

        <Card className="compact">
          <div className="tb-recent-head">
            <Glyph name="trophy" size={18} color="var(--tb-accent)" />
            <div className="tb-recent-title">Recently completed</div>
            <span className="tb-recent-meta">WORK AGAIN?</span>
          </div>
          {recentEntries.length === 0 ? (
            <div className="tb-recent-empty">
              No completed goals yet — finish one to see it here.
            </div>
          ) : (
            <div className="tb-recent-list">
              {recentEntries.map((g) => {
                const iconName: string = g.icon ?? 'spark';
                const points = g.kind === 'tiered'
                  ? `+${g.tier_values[0]}–${g.tier_values.at(-1)}`
                  : `+${g.points}`;
                return (
                  <div key={g.id} className="tb-recent-row">
                    <div className="tb-recent-icon">
                      <Glyph name={iconName} size={15} color="currentColor" />
                    </div>
                    <div className="tb-recent-body">
                      <div className="tb-recent-name">{g.name}</div>
                      <div className="tb-recent-sub">{points} PTS</div>
                    </div>
                    <button
                      type="button"
                      className="tb-recent-pick"
                      aria-label={g.maxed_out ? 'All done — unavailable' : 'Work on this again'}
                      title={g.maxed_out ? 'All done — unavailable' : 'Work on this again'}
                      onClick={() => onAddInProgress(g.id)}
                      disabled={g.maxed_out}
                    >
                      <Icon name="plus" size={14} stroke={2.4} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <button
            type="button"
            className="tb-recent-viewall"
            onClick={onPickGoalsView}
          >
            View all {catalogCount} goals →
          </button>
        </Card>

        {nextAway && (
          <Card className="compact">
            <SectionLabel>Next time away</SectionLabel>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginTop: 8,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  background: 'var(--tb-accent-soft)',
                  color: 'var(--tb-accent)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Glyph name="umbrella" size={18} color="currentColor" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{ fontSize: 13, fontWeight: 700, color: 'var(--tb-ink)' }}
                >
                  {nextAway.label}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--tb-font-mono)',
                    fontSize: 10,
                    color: 'var(--tb-muted)',
                    marginTop: 4,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                  }}
                >
                  {nextAway.start} → {nextAway.end} · routines suppressed
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      <div className="tb-main">
        {occError && <p className="tb-error">{occError}</p>}

        {inProgressEntries.length > 0 && (
          <div>
            <div className="tb-bucket-head">
              <Glyph name="trophy" size={16} color="var(--tb-accent)" />
              <span className="tb-bucket-label">Goals in progress</span>
              <span className="tb-bucket-rule" />
              <span className="tb-bucket-count">
                {inProgressEntries.length}/3
              </span>
            </div>
            <div className="tb-inprog-grid">
              {inProgressEntries.map(({ goal, started_at }) => {
                const iconName: string = goal.icon ?? 'spark';
                const isTiered = goal.kind === 'tiered';
                const isPending = pendingGoal.has(goal.id);
                const startedLabel = formatStartedAt(started_at, now, tz);
                const pointsLabel = isTiered
                  ? `+${goal.tier_values[0]}–${goal.tier_values.at(-1)}`
                  : `+${goal.points}`;
                return (
                  <div key={goal.id} className="tb-inprog-card">
                    <div className="tb-inprog-icon">
                      <Glyph name={iconName} size={18} color="currentColor" />
                    </div>
                    <div className="tb-inprog-body">
                      <div className="tb-inprog-name">{goal.name}</div>
                      <div className="tb-inprog-sub">
                        {pointsLabel} PTS · STARTED {startedLabel}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="tb-inprog-complete"
                      disabled={isPending || goal.maxed_out}
                      onClick={() => {
                        if (isTiered) {
                          onPickTier(goal);
                        } else {
                          onCompleteGoal(goal.id);
                        }
                      }}
                    >
                      {goal.maxed_out ? 'All done' : 'Complete'}
                    </button>
                    <button
                      type="button"
                      className="tb-inprog-clear"
                      aria-label="Clear without completing"
                      title="Clear without completing"
                      onClick={() => onRemoveInProgress(goal.id)}
                    >
                      <Icon name="x" size={12} stroke={2.4} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {restrictionActive && activeRestrictions && (
          <RestrictionActiveSection
            state={activeRestrictions}
            catalog={catalog}
            onCompleteGoal={onCompleteGoal}
            pendingGoal={pendingGoal}
            onAskParent={onAskParent}
            askParentBusy={askParentBusy}
            askParentDone={askParentDone}
            occurrencesById={occurrencesById}
            onLateComplete={onLateComplete}
            pending={pending}
            now={now}
          />
        )}

        {upNextRail.length > 0 && (
          <div>
            <div className="tb-bucket-head">
              <Glyph name="spark" size={16} color="var(--tb-ink2)" />
              <span className="tb-bucket-label">Up next (24h)</span>
              <span className="tb-bucket-rule" />
              <span className="tb-bucket-count">{upNextRail.length}</span>
            </div>
            <div className="tb-task-list">
              {upNextRail.map((occ) => (
                <UpNextRow key={occ.id} occ={occ} now={now} />
              ))}
            </div>
          </div>
        )}

        {BUCKET_ORDER.map((bucket) => {
          const items = buckets[bucket];
          if (items.length === 0) return null;
          const done = items.filter(
            (i) => i.status === 'complete' || i.clientAutoComplete,
          ).length;
          const live = items.filter((i) => i.status !== 'excused').length;
          return (
            <div key={bucket}>
              <div className="tb-bucket-head">
                <Glyph
                  name={BUCKET_GLYPHS[bucket]}
                  size={16}
                  color="var(--tb-ink2)"
                />
                <span className="tb-bucket-label">{BUCKET_LABELS[bucket]}</span>
                <span className="tb-bucket-time">{BUCKET_TIMES[bucket]}</span>
                <span className="tb-bucket-rule" />
                <span className="tb-bucket-count">
                  {done}/{live}
                </span>
              </div>
              <div className="tb-task-list">
                {items.map((occ) => (
                  <TaskRow
                    key={occ.id}
                    occ={occ}
                    onComplete={onMarkComplete}
                    onLateComplete={onLateComplete}
                    pending={pending.has(occ.id)}
                    now={now}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskRow({
  occ,
  onComplete,
  onLateComplete,
  pending,
  now,
}: {
  occ: GroupedOccurrence;
  onComplete: (id: string) => void;
  onLateComplete: (id: string) => void;
  pending: boolean;
  now: Date;
}) {
  const isReminder = occ.task_kind === 'reminder';
  const isWindowed = occ.task_kind === 'windowed';
  const isSuppressed = occ.presence_suppressed === true;
  const isComplete = occ.status === 'complete';
  const isPendingReview = occ.status === 'pending_review';
  const isExcused = occ.status === 'excused' || isSuppressed;
  const isMissed = occ.status === 'missed' && !isSuppressed;
  const lateOpen =
    isMissed &&
    !!occ.late_complete_until &&
    new Date(occ.late_complete_until).getTime() > now.getTime();
  const isDone = isComplete || (isReminder && occ.clientAutoComplete);

  const tileClass = isDone
    ? 'is-done'
    : isPendingReview
      ? 'is-pending'
      : isMissed
        ? 'is-missed'
        : '';

  const rowClass = `tb-task-row ${isDone ? 'is-done' : ''} ${isMissed && !lateOpen ? 'is-late' : ''}`;
  const due = isWindowed && occ.window_end_display
    ? `by ${occ.window_end_display}`
    : occ.display_time;

  return (
    <div className={rowClass}>
      <div className={`tb-task-tile ${tileClass}`}>
        {isDone ? (
          <Icon name="check" size={18} color="#0b1417" stroke={3} />
        ) : isPendingReview ? (
          <Icon name="clock" size={16} stroke={2.4} />
        ) : isMissed ? (
          <Icon name="alert" size={16} stroke={2.4} />
        ) : (
          <Icon name="dot" size={16} color="var(--tb-muted)" />
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="tb-task-name">
          <Glyph name={occ.task_icon ?? 'spark'} size={18} color="var(--tb-ink2)" />
          <span className={`tb-task-title ${isDone ? 'is-done' : ''}`}>
            {occ.task_name}
          </span>
          {isPendingReview && (
            <Pill tone="warn" style={{ textTransform: 'lowercase' }}>
              pending review
            </Pill>
          )}
          {isMissed && lateOpen && (
            <Pill tone="danger" style={{ textTransform: 'lowercase' }}>
              missed · late OK
            </Pill>
          )}
          {isMissed && !lateOpen && (
            <Pill tone="danger" style={{ textTransform: 'lowercase' }}>
              missed
            </Pill>
          )}
          {isReminder && (
            <Pill tone="muted" style={{ textTransform: 'lowercase' }}>
              reminder · auto ✓
            </Pill>
          )}
          {isWindowed && (
            <Pill tone="accent" style={{ textTransform: 'lowercase' }}>
              windowed
            </Pill>
          )}
          {isExcused && !isMissed && (
            <Pill tone="muted" style={{ textTransform: 'lowercase' }}>
              {isSuppressed ? 'away' : 'excused'}
            </Pill>
          )}
        </div>
      </div>
      <div className="tb-task-right">
        <div className="tb-task-due">{due}</div>
        {occ.task_points > 0 && (
          <div className="tb-task-points">+{occ.task_points} PTS</div>
        )}
        {!isDone && !isPendingReview && !isExcused && !isReminder && (
          <div style={{ marginTop: 6 }}>
            {lateOpen ? (
              <button
                type="button"
                className="tb-task-action is-late"
                onClick={() => onLateComplete(occ.id)}
                disabled={pending}
                title="Refunds the penalty, retracts the ladder advance, preserves the streak."
              >
                Late · {formatCountdown(occ.late_complete_until!, now)}
              </button>
            ) : isMissed ? null : (
              <button
                type="button"
                className="tb-task-action"
                onClick={() => onComplete(occ.id)}
                disabled={pending}
              >
                Mark done
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UpNextRow({ occ, now }: { occ: OccurrenceView; now: Date }) {
  return (
    <div className="tb-task-row">
      <div className="tb-task-tile">
        <Icon name="dot" size={16} color="var(--tb-muted)" />
      </div>
      <div className="tb-task-name">
        <Glyph name={occ.task_icon ?? 'spark'} size={18} color="var(--tb-ink2)" />
        <span className="tb-task-title">{occ.task_name}</span>
      </div>
      <div className="tb-task-right">
        <div className="tb-task-due">opens {occ.display_time}</div>
        <div className="tb-task-points">
          in {formatCountdown(occ.scheduled_at, now)}
        </div>
      </div>
    </div>
  );
}

const SCOPE_LABEL: Record<RestrictionScope, string> = {
  internet: 'all internet',
  entertainment: 'entertainment',
  games: 'games',
};

const SCOPE_GLYPH: Record<RestrictionScope, GlyphName> = {
  internet: 'wifi',
  entertainment: 'tv',
  games: 'gamepad',
};

function RestrictionActiveSection({
  state,
  catalog,
  onCompleteGoal,
  pendingGoal,
  onAskParent,
  askParentBusy,
  askParentDone,
  occurrencesById,
  onLateComplete,
  pending,
  now,
}: {
  state: TabletRestrictionView;
  catalog: CatalogGoalView[];
  onCompleteGoal: (
    goalId: string,
    tierValue?: number,
    restrictionId?: string,
  ) => void;
  pendingGoal: Set<string>;
  onAskParent: (scope: RestrictionScope) => void;
  askParentBusy: RestrictionScope | null;
  askParentDone: Set<RestrictionScope>;
  occurrencesById: Map<string, GroupedOccurrence>;
  onLateComplete: (id: string) => void;
  pending: Set<string>;
  now: Date;
}) {
  const tz = useHouseholdTimeZone();
  const goalById = new Map(catalog.map((c) => [c.id, c]));
  const lateLiftFor = (
    cause: RestrictionCauseView,
  ): { occId: string; taskName: string; closesAt: string } | null => {
    if (cause.kind !== 'miss' || !cause.occurrence_id) return null;
    const occ = occurrencesById.get(cause.occurrence_id);
    if (!occ) return null;
    if (occ.status !== 'missed') return null;
    if (!occ.late_complete_until) return null;
    if (new Date(occ.late_complete_until).getTime() <= now.getTime()) return null;
    return {
      occId: occ.id,
      taskName: cause.occurrence_task_name ?? occ.task_name,
      closesAt: occ.late_complete_until,
    };
  };
  const scopesBlocked = state.active.map((r) => SCOPE_LABEL[r.scope]).join(', ');
  const causeCount = state.active.reduce((a, r) => a + r.causes.length, 0);
  return (
    <Card style={{ borderColor: 'rgba(255,92,122,0.35)' }}>
      <div className="tb-restriction-head" style={{ marginBottom: 14 }}>
        <div className="tb-restriction-head-left">
          <div className="tb-restriction-icon">
            <Icon name="lock" size={24} stroke={2.4} />
          </div>
          <div>
            <div className="tb-restriction-eyebrow">Restriction · active</div>
            <div className="tb-restriction-title">
              {scopesBlocked} {state.active.length === 1 ? 'is' : 'are'} blocked
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <SectionLabel>Why · {causeCount} {causeCount === 1 ? 'cause' : 'causes'}</SectionLabel>
            <span
              style={{
                fontFamily: 'var(--tb-font-mono)',
                fontSize: 9,
                color: 'var(--tb-muted)',
                fontWeight: 800,
                letterSpacing: 0.5,
              }}
            >
              MOST-RESTRICTIVE WINS
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {state.active.flatMap((r) =>
              r.causes.map((c) => (
                <div key={c.id} className="tb-cause-row">
                  <div className="tb-cause-icon">
                    <Glyph name="alert" size={16} color="currentColor" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span className="tb-cause-kind">
                        {c.kind === 'admin' ? 'ADMIN CAUSE' : 'MISS CAUSE'}
                      </span>
                      <span className="tb-cause-title">
                        {c.kind === 'admin'
                          ? 'Blocked by an Admin'
                          : c.occurrence_task_name ?? 'Missed task'}
                      </span>
                    </div>
                    <div className="tb-cause-meta">
                      {SCOPE_LABEL[r.scope]}
                      {c.reason ? ` · ${c.reason}` : ''}
                    </div>
                    <div className="tb-cause-stats">
                      <span>
                        <span className="l">EXP </span>
                        {c.contributed_expires_at
                          ? formatTime(c.contributed_expires_at, tz)
                          : lateLiftFor(c)
                            ? 'late-complete'
                            : 'admin-only'}
                      </span>
                      <span>
                        <span className="l">REM </span>
                        {(c.contributed_remediation_goals?.length ?? 0) > 0
                          ? `${c.contributed_remediation_goals!.length} goals`
                          : lateLiftFor(c)
                            ? 'late-complete'
                            : 'admin-only'}
                      </span>
                    </div>
                  </div>
                </div>
              )),
            )}
          </div>
        </div>

        <div>
          <div className="tb-remediation-head">
            <Glyph name="unlock" size={16} color="var(--tb-ink)" />
            <span className="tb-remediation-title">Lift mechanisms</span>
            <span className="tb-remediation-rule" />
            <span className="tb-remediation-hint">PICK ANY ONE</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {state.active.map((r) => {
              const goals = (r.effective_remediation_goals ?? [])
                .map((id) => goalById.get(id))
                .filter((g): g is CatalogGoalView => !!g);
              const lateLifts = r.causes
                .map((c) => lateLiftFor(c))
                .filter((x): x is { occId: string; taskName: string; closesAt: string } => !!x);
              return (
                <div
                  key={r.scope}
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {lateLifts.map((lift) => (
                    <div
                      key={`late-${lift.occId}`}
                      className="tb-remediation-card is-primary"
                    >
                      <div className="tb-remediation-icon is-primary">
                        <Glyph name="alert" size={22} color="currentColor" />
                      </div>
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span className="tb-remediation-title2">
                            Late-complete · {lift.taskName}
                          </span>
                          <span className="tb-remediation-badge">
                            FULL LIFT
                          </span>
                        </div>
                        <div className="tb-remediation-sub">
                          Refunds points, retracts the ladder advance, preserves the
                          streak. Closes in {formatCountdown(lift.closesAt, now)}.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="tb-remediation-cta is-primary"
                        onClick={() => onLateComplete(lift.occId)}
                        disabled={pending.has(lift.occId)}
                      >
                        {pending.has(lift.occId) ? 'Saving…' : 'Mark complete now'}
                      </button>
                    </div>
                  ))}
                  {goals.map((goal) => (
                    <div
                      key={goal.id}
                      className="tb-remediation-card is-primary"
                    >
                      <div className="tb-remediation-icon is-primary">
                        <Glyph
                          name={goal.icon ?? 'trophy'}
                          size={22}
                          color="currentColor"
                        />
                      </div>
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span className="tb-remediation-title2">
                            Finish a goal · {goal.name}
                          </span>
                          <span className="tb-remediation-badge">
                            LIFTS {SCOPE_LABEL[r.scope].toUpperCase()}
                          </span>
                        </div>
                        <div className="tb-remediation-sub">
                          +{goal.points} pts · completes the lift; penalty stays.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="tb-remediation-cta is-primary"
                        onClick={() =>
                          onCompleteGoal(goal.id, undefined, r.id)
                        }
                        disabled={pendingGoal.has(goal.id) || goal.maxed_out}
                      >
                        {pendingGoal.has(goal.id) ? 'Saving…' : 'Finish'}
                      </button>
                    </div>
                  ))}
                  <div className="tb-remediation-card">
                    <div className="tb-remediation-icon">
                      <Glyph name="send" size={22} color="currentColor" />
                    </div>
                    <div>
                      <span className="tb-remediation-title2">
                        Ask an Admin · {SCOPE_LABEL[r.scope]}
                      </span>
                      <div className="tb-remediation-sub">
                        Surfaces a request to the admins as a pending review.
                        Doesn't lift on its own.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="tb-remediation-cta"
                      onClick={() => onAskParent(r.scope)}
                      disabled={
                        askParentBusy === r.scope || askParentDone.has(r.scope)
                      }
                    >
                      {askParentDone.has(r.scope) ? 'Sent ✓' : 'Send request'}
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="tb-remediation-card">
              <div className="tb-remediation-icon">
                <Glyph name="alert" size={22} color="currentColor" />
              </div>
              <div>
                <span className="tb-remediation-title2">Wait it out</span>
                <div className="tb-remediation-sub">
                  Auto-expires at the MAX of every cause's contributed expiry.
                </div>
              </div>
              <span
                className="tb-remediation-cta"
                style={{ cursor: 'default', opacity: 0.7 }}
              >
                AUTO
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="tb-scope-row" style={{ marginTop: 14, gap: 18 }}>
        {(['internet', 'entertainment', 'games'] as RestrictionScope[]).map(
          (scope) => {
            const blocked = state.active.some((r) => r.scope === scope);
            return (
              <div
                key={scope}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <div
                  className={`tb-scope-icon ${blocked ? 'is-blocked' : 'is-open'}`}
                  style={{ width: 28, height: 28 }}
                >
                  <Glyph
                    name={SCOPE_GLYPH[scope]}
                    size={14}
                    color="currentColor"
                  />
                </div>
                <Pill tone={blocked ? 'danger' : 'primary'}>
                  {blocked ? 'blocked' : 'open'}
                </Pill>
                <span
                  style={{
                    fontSize: 12,
                    color: blocked ? 'var(--tb-ink)' : 'var(--tb-muted)',
                  }}
                >
                  {SCOPE_LABEL[scope]}
                </span>
              </div>
            );
          },
        )}
      </div>
    </Card>
  );
}

const WINDOW_LABEL: Record<CatalogGoalView['limit_window'], string> = {
  day: 'TODAY',
  week: 'THIS WEEK',
  month: 'THIS MONTH',
  lifetime: 'EVER',
};

function GoalsCatalog({
  trackeeName,
  catalog,
  categories,
  categoryFilter,
  onPickCategory,
  onComplete,
  pending,
  error,
  onBack,
  favorites,
  inProgressIds,
  inProgressCount,
  onToggleFavorite,
  onAddInProgress,
  onRemoveInProgress,
  search,
  onSearchChange,
  onOpenFavorites,
  onPickTier,
  favoritesOnly = false,
}: {
  trackeeName: string;
  catalog: CatalogGoalView[];
  categories: CategoryView[];
  categoryFilter: string | null;
  onPickCategory: (id: string | null) => void;
  onComplete: (id: string, tierValue?: number) => void;
  pending: Set<string>;
  error: string | null;
  onBack: () => void;
  favorites: Set<string>;
  inProgressIds: Set<string>;
  inProgressCount: number;
  onToggleFavorite: (id: string) => void;
  onAddInProgress: (id: string) => void;
  onRemoveInProgress: (id: string) => void;
  search: string;
  onSearchChange: (next: string) => void;
  onOpenFavorites: () => void;
  onPickTier: (goal: CatalogGoalView) => void;
  favoritesOnly?: boolean;
}) {
  const totalGoals = catalog.length;
  const favCount = catalog.filter((g) => favorites.has(g.id)).length;

  const searchTerm = search.trim().toLowerCase();
  const base = favoritesOnly
    ? catalog.filter((g) => favorites.has(g.id))
    : catalog;
  const searched = searchTerm
    ? base.filter(
        (g) =>
          g.name.toLowerCase().includes(searchTerm) ||
          (g.note ?? '').toLowerCase().includes(searchTerm),
      )
    : base;
  const filtered =
    !favoritesOnly && categoryFilter
      ? searched.filter((g) => g.category_id === categoryFilter)
      : searched;

  const visibleCategoryIds = new Set(filtered.map((g) => g.category_id));
  const byCategory = new Map<string, CatalogGoalView[]>();
  for (const g of filtered) {
    const list = byCategory.get(g.category_id) ?? [];
    list.push(g);
    byCategory.set(g.category_id, list);
  }
  const orderedCategories = categories.filter((c) =>
    visibleCategoryIds.has(c.id),
  );

  return (
    <>
      <header className="tb-header">
        <div className="tb-header-left">
          <button
            type="button"
            className="tb-subheader-back"
            onClick={onBack}
            aria-label="Back to routine"
          >
            <Icon name="chevron-l" size={18} stroke={2.4} />
          </button>
          <div>
            <div className="tb-header-title">
              {favoritesOnly ? (
                <span className="tb-fav-title">
                  <span className="tb-star is-on">
                    <StarIcon size={18} stroke={2.2} filled />
                  </span>
                  Favorites · {trackeeName}
                </span>
              ) : (
                <>Goals · {trackeeName}</>
              )}
            </div>
            <div className="tb-header-sub">
              {favoritesOnly
                ? `${favCount} of ${totalGoals} starred · personal shortlist`
                : 'Opt-in activities · Week resets Monday'}
            </div>
          </div>
        </div>
        <div className="tb-header-right">
          {favoritesOnly ? (
            <button
              type="button"
              className="tb-goals-pivot is-back"
              onClick={onOpenFavorites}
              aria-label="Back to all goals"
            >
              <Icon name="chevron-l" size={14} stroke={2.4} />
              All goals · {totalGoals}
            </button>
          ) : (
            <button
              type="button"
              className="tb-goals-pivot"
              onClick={onOpenFavorites}
              aria-label="Open favorites"
            >
              <StarIcon size={14} stroke={2.2} filled />
              Favorites · {favCount}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div style={{ padding: '0 22px' }}>
          <p className="tb-error">{error}</p>
        </div>
      )}

      <div className="tb-goals-filterbar">
        <div className="tb-goals-search">
          <Icon name="search" size={14} stroke={2.4} color="var(--tb-muted)" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search goals…"
            aria-label="Search goals"
          />
        </div>
        {!favoritesOnly && (
          <>
            <Chip
              on={categoryFilter === null}
              onClick={() => onPickCategory(null)}
            >
              All · {totalGoals}
            </Chip>
            {categories
              .filter((c) =>
                catalog.some((g) => g.category_id === c.id),
              )
              .map((c) => {
                const count = catalog.filter((g) => g.category_id === c.id)
                  .length;
                return (
                  <Chip
                    key={c.id}
                    on={categoryFilter === c.id}
                    onClick={() => onPickCategory(c.id)}
                  >
                    {c.name} · {count}
                  </Chip>
                );
              })}
          </>
        )}
        {!favoritesOnly && inProgressCount > 0 && (
          <span className="tb-inprog-pill">
            <PinIcon size={11} stroke={2.4} />
            {inProgressCount}/3 IN PROGRESS
          </span>
        )}
      </div>

      <div className="tb-goals-scroll">
        {filtered.length === 0 ? (
          <div className="tb-empty">
            {favoritesOnly ? (
              <>
                <StarIcon size={28} stroke={1.8} />
                <div className="tb-empty-title">No favorites yet</div>
                <div className="tb-empty-sub">
                  Tap the ★ on any goal to pin it here.
                </div>
              </>
            ) : searchTerm ? (
              `No goals match “${search}”.`
            ) : (
              'No goals here yet. Add some in the admin browser.'
            )}
          </div>
        ) : (
          orderedCategories
            .filter((c) => (byCategory.get(c.id) ?? []).length > 0)
            .map((c) => {
              const items = byCategory.get(c.id) ?? [];
              return (
                <div key={c.id} className="tb-goals-section">
                  <div className="tb-goals-section-head">
                    <span className="tb-goals-section-title">{c.name}</span>
                    <span className="tb-goals-section-rule" />
                    <span className="tb-goals-section-count">
                      {items.length} GOAL{items.length === 1 ? '' : 'S'}
                    </span>
                  </div>
                  <div className="tb-goal-grid">
                    {items.map((g) => (
                      <GoalCard
                        key={g.id}
                        goal={g}
                        isPending={pending.has(g.id)}
                        isFavorite={favorites.has(g.id)}
                        isInProgress={inProgressIds.has(g.id)}
                        onComplete={onComplete}
                        onToggleFavorite={onToggleFavorite}
                        onAddInProgress={onAddInProgress}
                        onRemoveInProgress={onRemoveInProgress}
                        onPickTier={onPickTier}
                      />
                    ))}
                  </div>
                </div>
              );
            })
        )}
      </div>
    </>
  );
}

function GoalCard({
  goal,
  isPending,
  isFavorite,
  isInProgress,
  onComplete,
  onToggleFavorite,
  onAddInProgress,
  onRemoveInProgress,
  onPickTier,
}: {
  goal: CatalogGoalView;
  isPending: boolean;
  isFavorite: boolean;
  isInProgress: boolean;
  onComplete: (id: string, tierValue?: number) => void;
  onToggleFavorite: (id: string) => void;
  onAddInProgress: (id: string) => void;
  onRemoveInProgress: (id: string) => void;
  onPickTier: (goal: CatalogGoalView) => void;
}) {
  const isTiered = goal.kind === 'tiered';
  const isLifetime =
    goal.limit_window === 'lifetime' || goal.completion_limit >= 999;
  const completedSoFar = Math.max(0, goal.completion_limit - goal.remaining);
  const meta = isLifetime
    ? 'ANY TIME'
    : `${completedSoFar}/${goal.completion_limit} ${WINDOW_LABEL[goal.limit_window]}`;
  const iconName: string = goal.icon ?? 'spark';
  const tone =
    isKnownGlyph(iconName) && ['draw', 'blocks', 'spark', 'edit'].includes(iconName)
      ? 'accent'
      : 'primary';
  const tierRange = isTiered
    ? `+${goal.tier_values[0]}–${goal.tier_values.at(-1)}`
    : null;

  return (
    <div
      className={`tb-goal-card ${goal.maxed_out ? 'is-maxed' : ''} ${
        isInProgress ? 'is-in-progress' : ''
      }`}
    >
      <button
        type="button"
        className={`tb-goal-card-star ${isFavorite ? 'is-on' : ''}`}
        onClick={() => onToggleFavorite(goal.id)}
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={isFavorite}
      >
        <StarIcon size={14} stroke={2.2} filled={isFavorite} />
      </button>

      <div className="tb-goal-card-top">
        <div className={`tb-goal-card-icon ${tone}`}>
          <Glyph name={iconName} size={20} color="currentColor" />
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 28 }}>
          <div className="tb-goal-card-name">{goal.name}</div>
          {goal.note && <div className="tb-goal-card-note">{goal.note}</div>}
        </div>
      </div>

      {isTiered ? (
        <div className="tb-goal-card-meta-row">
          <Pill tone="accent">TIERED · {tierRange}</Pill>
          <span className="tb-goal-card-meta">{isLifetime ? 'ANY TIME' : meta}</span>
        </div>
      ) : (
        <div className="tb-goal-card-meta-row">
          <Pill tone="primary">+{goal.points} PTS</Pill>
          <span className="tb-goal-card-meta">{meta}</span>
        </div>
      )}

      <div className="tb-goal-card-actions">
        {isInProgress ? (
          <button
            type="button"
            className="tb-goal-card-pin is-on"
            onClick={() => onRemoveInProgress(goal.id)}
            aria-label="Clear in-progress"
            title="Clear in-progress"
          >
            <PinIcon size={12} stroke={2.4} /> In progress
          </button>
        ) : (
          <button
            type="button"
            className="tb-goal-card-pin"
            onClick={() => onAddInProgress(goal.id)}
            disabled={isPending || goal.maxed_out}
            aria-label="Work on this"
          >
            <PinIcon size={12} stroke={2.4} /> Work on this
          </button>
        )}
        <button
          type="button"
          className={`tb-goal-card-action ${goal.maxed_out ? 'is-muted' : ''}`}
          onClick={() => (isTiered ? onPickTier(goal) : onComplete(goal.id))}
          disabled={goal.maxed_out || isPending}
        >
          {goal.maxed_out
            ? `All done ${WINDOW_LABEL[goal.limit_window].toLowerCase()}`
            : 'I did this'}
        </button>
      </div>
    </div>
  );
}

function PointsHistory({
  trackeeName,
  userId,
  tabletToken,
  balance,
  rate,
  pendingCashOut,
  streak,
  admins,
  onBack,
  onOpenCashOut,
}: {
  trackeeName: string;
  userId: string;
  tabletToken: string;
  balance: number;
  rate: number;
  pendingCashOut: boolean;
  streak: number;
  admins: TrackeeView[];
  onBack: () => void;
  onOpenCashOut: () => void;
}) {
  const tz = useHouseholdTimeZone();
  const [filter, setFilter] = useState<'all' | 'earned' | 'spent'>('all');
  const [history, setHistory] = useState<TransactionView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const h = await transactionsApi.history(tabletToken, userId, filter);
      setHistory(h.transactions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load history');
    }
  }, [tabletToken, userId, filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const adminLabel =
    admins.length === 0
      ? 'an Admin'
      : admins.map((a) => a.display_name).join(' or ');
  const negative = balance < 0;
  const week = computeWeeklyBuckets(history, tz);
  const max = Math.max(1, ...week.map((w) => w.amount));
  const earnedThisWeek = week.reduce((a, w) => a + w.amount, 0);

  return (
    <>
      <header className="tb-header">
        <div className="tb-header-left">
          <button
            type="button"
            className="tb-subheader-back"
            onClick={onBack}
            aria-label="Back to routine"
          >
            <Icon name="chevron-l" size={18} stroke={2.4} />
          </button>
          <div>
            <div className="tb-header-title">Ledger · {trackeeName}</div>
            <div className="tb-header-sub">
              Rate · 1 PT = ${rate.toFixed(2)} · ledger is append-only
            </div>
          </div>
        </div>
        <div className="tb-header-right">
          {streak > 0 && (
            <Pill tone="warn">
              <Icon name="fire" size={13} stroke={2.2} /> {streak}-day streak
            </Pill>
          )}
        </div>
      </header>

      {error && (
        <div style={{ padding: '0 22px' }}>
          <p className="tb-error">{error}</p>
        </div>
      )}

      <div className="tb-body cols-2-wide">
        <div className="tb-rail">
          <div className="tb-balance-hero">
            <div className="tb-balance-watermark">
              <HolocronLogo size={140} glow={false} />
            </div>
            <SectionLabel>Balance</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 6 }}>
              <span className="tb-balance-num">{balance}</span>
              <span className="tb-balance-unit">pts</span>
            </div>
            <div className="tb-balance-dollars">
              <Icon name="coin" size={16} stroke={2.4} />
              <span>= ${(balance * rate).toFixed(2)} IF YOU CASH OUT</span>
            </div>
            <button
              type="button"
              className={`tb-balance-cta ${negative || pendingCashOut || balance === 0 ? 'is-muted' : ''}`}
              disabled={negative || pendingCashOut || balance === 0}
              onClick={onOpenCashOut}
            >
              {negative
                ? 'Cash out · unavailable'
                : pendingCashOut
                  ? 'Cash-out pending…'
                  : 'Request cash-out'}
            </button>
            <div className="tb-balance-foot">
              {negative
                ? 'Balance is negative — earn back to zero first.'
                : `Sends a request to ${adminLabel}. Money moves when an Admin commits it.`}
            </div>
          </div>

          <Card>
            <SectionLabel>This week · earned</SectionLabel>
            <div className="tb-week-grid">
              {week.map((w) => {
                const h = (w.amount / max) * 100;
                return (
                  <div className="tb-week-col" key={w.label}>
                    <div
                      className={`tb-week-bar ${w.isToday ? 'is-today' : ''}`}
                      style={{ height: `${Math.max(2, h)}%` }}
                    />
                    <span
                      className={`tb-week-label ${w.isToday ? 'is-today' : ''}`}
                    >
                      {w.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="tb-week-foot">
              <span className="l">TOTAL EARNED</span>
              <span className="v">+{earnedThisWeek} PTS</span>
            </div>
          </Card>
        </div>

        <div className="tb-main">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 4,
            }}
          >
            <SectionLabel>History</SectionLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              <Chip on={filter === 'all'} onClick={() => setFilter('all')}>
                All
              </Chip>
              <Chip on={filter === 'earned'} onClick={() => setFilter('earned')}>
                Earned
              </Chip>
              <Chip on={filter === 'spent'} onClick={() => setFilter('spent')}>
                Spent
              </Chip>
            </div>
          </div>
          <TransactionList
            transactions={history}
            emptyMessage="No transactions yet."
          />
        </div>
      </div>
    </>
  );
}

function readLastActiveId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('holocron.lastActiveTab');
  } catch {
    return null;
  }
}

let _audioCtx: AudioContext | null = null;

function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!_audioCtx) _audioCtx = new Ctor();
  if (_audioCtx.state === 'suspended') void _audioCtx.resume();
  return _audioCtx;
}

async function playChime(): Promise<void> {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const notes = [659.25, 783.99, 1046.5];
  const now = ctx.currentTime;
  notes.forEach((freq, i) => {
    const start = now + i * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.35);
  });
}

const DOW_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function computeWeeklyBuckets(
  transactions: TransactionView[],
  tz: string,
): Array<{ label: string; amount: number; isToday: boolean }> {
  const buckets = DOW_LABELS.map((label) => ({
    label,
    amount: 0,
    isToday: false,
  }));
  const todayIso = isoDateInTz(new Date(), tz);
  // ISO week starts Monday — bucket by household-local civil day.
  const isoDow = (dowInTz(new Date(), tz) + 6) % 7;
  buckets[isoDow].isToday = true;
  // First household-local civil day of this ISO week (`todayIso` minus isoDow).
  const startOfWeekIso = isoDateInTz(
    new Date(utcInstantInTz(`${todayIso}T00:00`, tz).getTime() - isoDow * 86_400_000),
    tz,
  );
  for (const t of transactions) {
    if (t.amount <= 0) continue;
    const dayIso = isoDateInTz(t.created_at, tz);
    if (dayIso < startOfWeekIso) continue;
    const bucketDow = (dowInTz(t.created_at, tz) + 6) % 7;
    buckets[bucketDow].amount += t.amount;
  }
  return buckets;
}

function formatCountdown(untilIso: string, now: Date): string {
  const ms = new Date(untilIso).getTime() - now.getTime();
  if (ms <= 0) return '0m';
  const totalMin = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatTime(iso: string, tz: string): string {
  return wallClockInTz(iso, tz);
}

function formatClock(d: Date, tz: string): string {
  return wallClockInTz(d, tz);
}

function formatStatusDate(d: Date, tz: string): string {
  return dottedDateInTz(d, tz);
}

function formatHeaderDate(d: Date, tz: string): string {
  return `${dowLabelInTz(d, tz)} · ${formatStatusDate(d, tz)}`;
}

function greetingFor(d: Date, tz: string): string {
  const h = hourInTz(d, tz);
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function formatStartedAt(iso: string, now: Date, tz: string): string {
  const d = new Date(iso);
  if (isoDateInTz(d, tz) === isoDateInTz(now, tz)) return 'TODAY';
  const diffDays = Math.floor(
    (now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays >= 1 && diffDays < 7) return DAY_LABELS[dowInTz(d, tz)];
  return formatStatusDate(d, tz);
}
