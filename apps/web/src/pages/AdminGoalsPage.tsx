import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useSocket } from '../hooks/useSocket';
import {
  CategoryView,
  CreateGoalPayload,
  GoalView,
  LimitWindow,
  TrackeeView,
  UpdateGoalPayload,
  categoriesApi,
  goalsApi,
  usersApi,
} from '../auth/api';
import { AdminShell } from '../admin/AdminShell';
import { IconPicker } from '../admin/IconPicker';
import { Segmented } from '../admin/Segmented';
import { CheckRow } from '../admin/CheckRow';
import { Glyph } from '../tablet/icons/Glyph';
import { listVariants } from '../celebration/registry';
// Side-effect register the built-in default variant so it appears in the
// admin picker even when the celebration overlay hasn't fired yet.
import '../celebration/default-variant';

const CELEBRATION_VARIANTS = listVariants();

type FormMode =
  | { kind: 'idle' }
  | { kind: 'create' }
  | { kind: 'edit'; id: string };

type GoalKind = 'flat' | 'tiered';

interface GoalFormState {
  name: string;
  icon: string;
  note: string;
  category_id: string;
  kind: GoalKind;
  points: string;
  tier_values: string[];
  completion_limit: string;
  limit_window: LimitWindow;
  show_in_catalog: boolean;
  usable_as_remediation: boolean;
  assigned_to_user_id: string;
  active: boolean;
  celebration_variant_id: string;
}

const CATEGORY_PALETTE = [
  '#00E5FF', // holocron-cyan (primary)
  '#7C4DFF', // accent violet
  '#FFB300', // command-amber (warn)
  '#FF5252', // danger red
  '#26C6DA', // info teal
  '#69F0AE', // success green
];

const ALL_CATEGORIES = '__all__';

function blankForm(defaultCategoryId: string): GoalFormState {
  return {
    name: '',
    icon: '',
    note: '',
    category_id: defaultCategoryId,
    kind: 'flat',
    points: '10',
    tier_values: ['10', '20', '30'],
    completion_limit: '1',
    limit_window: 'week',
    show_in_catalog: true,
    usable_as_remediation: false,
    assigned_to_user_id: '',
    active: true,
    celebration_variant_id: '',
  };
}

function formFromGoal(g: GoalView): GoalFormState {
  return {
    name: g.name,
    icon: g.icon ?? '',
    note: g.note ?? '',
    category_id: g.category_id,
    kind: g.kind,
    points: String(g.points),
    tier_values:
      g.tier_values && g.tier_values.length > 0
        ? g.tier_values.map((n) => String(n))
        : ['10', '20', '30'],
    completion_limit: String(g.completion_limit),
    limit_window: g.limit_window,
    show_in_catalog: g.show_in_catalog,
    usable_as_remediation: g.usable_as_remediation,
    assigned_to_user_id: g.assigned_to_user_id ?? '',
    active: g.active,
    celebration_variant_id: g.celebration_variant_id ?? '',
  };
}

export function AdminGoalsPage() {
  const { session } = useAuth();
  const adminToken = session.kind === 'admin' ? session.token : null;
  const { on } = useSocket(adminToken);

  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [goals, setGoals] = useState<GoalView[]>([]);
  const [trackees, setTrackees] = useState<TrackeeView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState<string>(ALL_CATEGORIES);
  const [mode, setMode] = useState<FormMode>({ kind: 'idle' });
  const [form, setForm] = useState<GoalFormState>(blankForm(''));
  const [newCategoryName, setNewCategoryName] = useState('');

  const refresh = useCallback(async () => {
    if (!adminToken) return;
    try {
      const [
        { categories: nextCategories },
        { goals: nextGoals },
        { trackees: nextTrackees },
      ] = await Promise.all([
        categoriesApi.list(adminToken),
        goalsApi.list(adminToken),
        usersApi.list(adminToken),
      ]);
      setCategories(nextCategories);
      setGoals(nextGoals);
      setTrackees(nextTrackees);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load goals');
    }
  }, [adminToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = on('goals:changed', () => void refresh());
    return off;
  }, [on, refresh]);

  const activeTrackees = useMemo(
    () => trackees.filter((t) => t.deactivated_at === null),
    [trackees],
  );

  const categoryColor = useCallback(
    (id: string) => {
      const idx = categories.findIndex((c) => c.id === id);
      return CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length] ?? '#00E5FF';
    },
    [categories],
  );

  const visibleGoals = useMemo(
    () =>
      activeCategoryId === ALL_CATEGORIES
        ? goals
        : goals.filter((g) => g.category_id === activeCategoryId),
    [goals, activeCategoryId],
  );

  const selectedGoal = useMemo(() => {
    if (mode.kind !== 'edit') return null;
    return goals.find((g) => g.id === mode.id) ?? null;
  }, [mode, goals]);

  const startCreate = () => {
    if (categories.length === 0) {
      setError('create a category first');
      return;
    }
    const seedCategory =
      activeCategoryId !== ALL_CATEGORIES ? activeCategoryId : categories[0].id;
    setMode({ kind: 'create' });
    setForm(blankForm(seedCategory));
    setError(null);
  };

  const startEdit = (g: GoalView) => {
    setMode({ kind: 'edit', id: g.id });
    setForm(formFromGoal(g));
    setError(null);
  };

  const cancel = () => {
    setMode({ kind: 'idle' });
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || mode.kind === 'idle') return;
    const completionLimit = Number(form.completion_limit);
    if (
      !Number.isInteger(completionLimit) ||
      completionLimit < 1 ||
      completionLimit > 999
    ) {
      setError('completion limit must be 1–999');
      return;
    }
    let points = 0;
    let tierValues: number[] | undefined;
    if (form.kind === 'flat') {
      points = Number(form.points);
      if (!Number.isInteger(points) || points < 0) {
        setError('points must be a non-negative integer');
        return;
      }
    } else {
      const parsed = form.tier_values.map((v) => Number(v));
      if (parsed.length === 0 || parsed.some((n) => !Number.isInteger(n) || n < 1)) {
        setError('each tier must be a positive integer');
        return;
      }
      tierValues = parsed;
    }
    setBusy(true);
    setError(null);
    try {
      const assigned = form.assigned_to_user_id || null;
      if (mode.kind === 'create') {
        const payload: CreateGoalPayload = {
          name: form.name.trim(),
          category_id: form.category_id,
          kind: form.kind,
          points,
          completion_limit: completionLimit,
          limit_window: form.limit_window,
          show_in_catalog: form.show_in_catalog,
          usable_as_remediation: form.usable_as_remediation,
          assigned_to_user_id: assigned,
          active: form.active,
          celebration_variant_id: form.celebration_variant_id || null,
        };
        if (tierValues) payload.tier_values = tierValues;
        if (form.icon.trim()) payload.icon = form.icon.trim();
        if (form.note.trim()) payload.note = form.note.trim();
        await goalsApi.create(adminToken, payload);
      } else {
        const payload: UpdateGoalPayload = {
          name: form.name.trim(),
          category_id: form.category_id,
          kind: form.kind,
          points,
          completion_limit: completionLimit,
          limit_window: form.limit_window,
          show_in_catalog: form.show_in_catalog,
          usable_as_remediation: form.usable_as_remediation,
          assigned_to_user_id: assigned,
          active: form.active,
          icon: form.icon.trim() ? form.icon.trim() : null,
          note: form.note.trim() ? form.note.trim() : null,
          celebration_variant_id: form.celebration_variant_id || null,
        };
        if (tierValues) payload.tier_values = tierValues;
        await goalsApi.update(adminToken, mode.id, payload);
      }
      cancel();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  const removeGoal = async (g: GoalView) => {
    if (!adminToken) return;
    if (!confirm(`Delete goal "${g.name}"?`)) return;
    setBusy(true);
    try {
      await goalsApi.remove(adminToken, g.id);
      if (mode.kind === 'edit' && mode.id === g.id) cancel();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    const name = newCategoryName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await categoriesApi.create(adminToken, { name });
      setNewCategoryName('');
      await refresh();
      setActiveCategoryId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'category create failed');
    } finally {
      setBusy(false);
    }
  };

  const renameCategory = async (c: CategoryView) => {
    if (!adminToken) return;
    const next = prompt(`Rename "${c.name}" to:`, c.name);
    if (!next || next.trim() === c.name) return;
    setBusy(true);
    try {
      await categoriesApi.update(adminToken, c.id, { name: next.trim() });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'category rename failed');
    } finally {
      setBusy(false);
    }
  };

  const deleteCategory = async (c: CategoryView) => {
    if (!adminToken) return;
    if (!confirm(`Delete category "${c.name}"?`)) return;
    setBusy(true);
    try {
      await categoriesApi.remove(adminToken, c.id);
      if (activeCategoryId === c.id) setActiveCategoryId(ALL_CATEGORIES);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'category delete failed');
    } finally {
      setBusy(false);
    }
  };

  if (session.kind !== 'admin') return null;
  const categoryName = (id: string) =>
    categories.find((c) => c.id === id)?.name ?? '∅';

  const goalCount = goals.length;
  const subtitle = `Opt-in point-earning activities · ${goalCount} total`;

  return (
    <AdminShell
      active="goals"
      title="Goals"
      subtitle={subtitle}
      actions={
        <button type="button" className="auth-submit" onClick={startCreate}>
          + New goal
        </button>
      }
    >
      {error && <p className="auth-error">{error}</p>}

      <div className="goals-layout-v2">
        <aside className="goals-sidebar-v2">
          <div className="goals-sidebar-heading-v2">Categories</div>
          <ul className="goals-category-list-v2">
            <li>
              <button
                type="button"
                className={`goals-category-row ${activeCategoryId === ALL_CATEGORIES ? 'is-active' : ''}`}
                onClick={() => setActiveCategoryId(ALL_CATEGORIES)}
              >
                <span className="goals-category-dot" style={{ visibility: 'hidden' }} />
                <span className="goals-category-row-label">All goals</span>
                <span className="goals-category-row-count">{goals.length}</span>
              </button>
            </li>
            {categories.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`goals-category-row ${c.id === activeCategoryId ? 'is-active' : ''}`}
                  style={{
                    borderLeftColor:
                      c.id === activeCategoryId ? categoryColor(c.id) : 'transparent',
                  }}
                  onClick={() => setActiveCategoryId(c.id)}
                  onDoubleClick={() => renameCategory(c)}
                  title="Double-click to rename"
                >
                  <span
                    className="goals-category-dot"
                    style={{ background: categoryColor(c.id) }}
                  />
                  <span className="goals-category-row-label">{c.name}</span>
                  <span className="goals-category-row-count">
                    {goals.filter((g) => g.category_id === c.id).length}
                  </span>
                  <button
                    type="button"
                    className="goals-category-row-x"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteCategory(c);
                    }}
                    aria-label={`Delete ${c.name}`}
                    title="Delete category"
                  >
                    ✕
                  </button>
                </button>
              </li>
            ))}
          </ul>
          <form className="goals-new-category-v2" onSubmit={addCategory}>
            <input
              value={newCategoryName}
              placeholder="New category"
              onChange={(e) => setNewCategoryName(e.target.value)}
            />
            <button type="submit" className="goals-new-category-btn" disabled={busy}>
              + New category
            </button>
          </form>
        </aside>

        <section className="goals-table-card">
          <div className="goals-table-head">
            <div>Goal · category</div>
            <div>Points</div>
            <div>Limit</div>
            <div>Flags</div>
          </div>
          {visibleGoals.length === 0 && (
            <div className="goals-table-empty">
              {activeCategoryId === ALL_CATEGORIES
                ? 'No goals yet. Click + New goal to create one.'
                : `No goals in ${categoryName(activeCategoryId)} yet.`}
            </div>
          )}
          {visibleGoals.map((g) => {
            const isSelected = mode.kind === 'edit' && mode.id === g.id;
            const pointsLabel =
              g.kind === 'tiered'
                ? `+${g.tier_values.join('/')}`
                : `+${g.points}`;
            const limitLabel =
              g.completion_limit >= 999
                ? '∞'
                : `${g.completion_limit}/${g.limit_window.toUpperCase()}`;
            return (
              <button
                type="button"
                key={g.id}
                className={`goals-table-row ${isSelected ? 'is-selected' : ''} ${g.active ? '' : 'is-inactive'}`}
                style={{
                  borderLeftColor: isSelected ? categoryColor(g.category_id) : 'transparent',
                }}
                onClick={() => startEdit(g)}
              >
                <div className="goals-row-name-cell">
                  <div className="goals-row-icon">
                    {g.icon ? (
                      <Glyph name={g.icon} size={18} color="currentColor" />
                    ) : (
                      '★'
                    )}
                  </div>
                  <div className="goals-row-name-block">
                    <div className="goals-row-name">
                      {g.name}
                      {g.kind === 'tiered' && (
                        <span className="goals-tag goals-tag-tiered">TIERED</span>
                      )}
                      {!g.active && (
                        <span className="goals-tag goals-tag-inactive">INACTIVE</span>
                      )}
                    </div>
                    <div className="goals-row-subtitle">
                      {categoryName(g.category_id)}
                    </div>
                  </div>
                </div>
                <div className="goals-row-points">{pointsLabel}</div>
                <div className="goals-row-limit">{limitLabel}</div>
                <div className="goals-row-flags">
                  {g.usable_as_remediation && (
                    <span className="goals-flag-pill goals-flag-rem" title="Used as remediation">
                      REM
                    </span>
                  )}
                  {g.show_in_catalog && (
                    <span className="goals-flag-pill goals-flag-cat" title="Show in catalog">
                      CAT
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </section>

        <aside className="goals-edit-panel">
          {mode.kind === 'idle' ? (
            <div className="goals-edit-empty">
              <p>Select a goal to edit, or click <strong>+ New goal</strong> above.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="goals-edit-form">
              <header className="goals-edit-header">
                <div
                  className="goals-edit-header-icon"
                  style={{
                    background: `${categoryColor(form.category_id)}22`,
                    color: categoryColor(form.category_id),
                    borderColor: `${categoryColor(form.category_id)}55`,
                  }}
                >
                  {form.icon ? (
                    <Glyph name={form.icon} size={24} color="currentColor" />
                  ) : (
                    '★'
                  )}
                </div>
                <div className="goals-edit-header-text">
                  <div className="goals-edit-header-title">
                    {mode.kind === 'create' ? 'New goal' : form.name || 'Untitled goal'}
                  </div>
                  <div className="goals-edit-header-subtitle">
                    {categoryName(form.category_id)}
                    {form.usable_as_remediation ? ' · used as remediation' : ''}
                  </div>
                </div>
              </header>

              <Section title="Basics">
                <Field label="Name">
                  <input
                    required
                    value={form.name}
                    placeholder="Read a book"
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </Field>
                <div className="goals-edit-pair">
                  <Field label="Category">
                    <select
                      className="admin-select"
                      value={form.category_id}
                      onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Icon">
                    <IconPicker
                      value={form.icon}
                      onChange={(v) => setForm({ ...form, icon: v })}
                    />
                  </Field>
                </div>
                <Field
                  label="Note (optional)"
                  help="Shown under the goal name in the tablet catalog."
                >
                  <input
                    value={form.note}
                    placeholder="Read for 30 min and tell us about it"
                    maxLength={240}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                  />
                </Field>
              </Section>

              <Section title="Reward">
                <Segmented
                  options={[
                    { value: 'flat', label: 'Flat' },
                    { value: 'tiered', label: 'Tiered' },
                  ]}
                  value={form.kind}
                  onChange={(v) => setForm({ ...form, kind: v as GoalKind })}
                />
                <div className="goals-edit-pair">
                  {form.kind === 'flat' ? (
                    <Field label="Points">
                      <input
                        type="number"
                        min={0}
                        required
                        value={form.points}
                        onChange={(e) => setForm({ ...form, points: e.target.value })}
                      />
                    </Field>
                  ) : (
                    <Field label="Points" help="Set tier values in the Tiers section">
                      <input value="—" disabled />
                    </Field>
                  )}
                  <Field label="Completion limit" help="1–999 (999 = unlimited)">
                    <input
                      type="number"
                      min={1}
                      max={999}
                      required
                      value={form.completion_limit}
                      onChange={(e) =>
                        setForm({ ...form, completion_limit: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <Field label="Limit window">
                  <Segmented
                    options={[
                      { value: 'day', label: 'Day' },
                      { value: 'week', label: 'Week' },
                      { value: 'month', label: 'Month' },
                      { value: 'lifetime', label: 'Lifetime' },
                    ]}
                    value={form.limit_window}
                    onChange={(v) =>
                      setForm({ ...form, limit_window: v as LimitWindow })
                    }
                  />
                </Field>
              </Section>

              <Section
                title="Tiers"
                tail={
                  form.kind === 'flat' ? (
                    <span className="goals-section-tail">FLAT — DISABLED</span>
                  ) : undefined
                }
              >
                {form.kind === 'flat' ? (
                  <div className="goals-tier-hint">
                    Switch to <b>Tiered</b> above to define tier values (e.g.{' '}
                    <b>10 / 20 / 30 / 40 / 50</b> pts). The Trackee picks the tier on
                    completion. A single <b>completion_limit</b> applies across all
                    tiers.
                  </div>
                ) : (
                  <div className="tier-list">
                    <ul className="tier-rows">
                      {form.tier_values.map((value, idx) => (
                        <li key={idx} className="tier-row">
                          <span className="tier-row-index">#{idx + 1}</span>
                          <input
                            type="number"
                            min={1}
                            required
                            value={value}
                            onChange={(e) => {
                              const next = [...form.tier_values];
                              next[idx] = e.target.value;
                              setForm({ ...form, tier_values: next });
                            }}
                          />
                          <button
                            type="button"
                            className="logout-button"
                            disabled={idx === 0}
                            onClick={() => {
                              const next = [...form.tier_values];
                              [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                              setForm({ ...form, tier_values: next });
                            }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="logout-button"
                            disabled={idx === form.tier_values.length - 1}
                            onClick={() => {
                              const next = [...form.tier_values];
                              [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                              setForm({ ...form, tier_values: next });
                            }}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="logout-button"
                            disabled={form.tier_values.length <= 1}
                            onClick={() => {
                              const next = form.tier_values.filter(
                                (_, i) => i !== idx,
                              );
                              setForm({ ...form, tier_values: next });
                            }}
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="logout-button"
                      onClick={() => {
                        const last =
                          Number(form.tier_values[form.tier_values.length - 1]) || 0;
                        const next = [...form.tier_values, String(last + 10)];
                        setForm({ ...form, tier_values: next });
                      }}
                    >
                      + Add tier
                    </button>
                  </div>
                )}
              </Section>

              <Section title="Use cases · flags">
                <CheckRow
                  on={form.show_in_catalog}
                  label="Show in catalog"
                  onChange={(v) => setForm({ ...form, show_in_catalog: v })}
                />
                <CheckRow
                  on={form.usable_as_remediation}
                  label="Use as restriction remediation"
                  onChange={(v) => setForm({ ...form, usable_as_remediation: v })}
                />
                <CheckRow
                  on={form.assigned_to_user_id !== ''}
                  label="Assigned to one Trackee"
                  help="When set, the goal is visible only to that Trackee"
                  onChange={(v) =>
                    setForm({
                      ...form,
                      assigned_to_user_id:
                        v && activeTrackees.length > 0 ? activeTrackees[0].id : '',
                    })
                  }
                />
                {form.assigned_to_user_id !== '' && (
                  <Field label="Trackee">
                    <select
                      className="admin-select"
                      value={form.assigned_to_user_id}
                      onChange={(e) =>
                        setForm({ ...form, assigned_to_user_id: e.target.value })
                      }
                    >
                      {activeTrackees.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.display_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <CheckRow
                  on={form.active}
                  label="Active"
                  help="Inactive goals are hidden from the catalog and can't be completed"
                  onChange={(v) => setForm({ ...form, active: v })}
                />
                <Field label="Celebration variant">
                  <select
                    value={form.celebration_variant_id}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        celebration_variant_id: e.target.value,
                      })
                    }
                  >
                    <option value="">Random (default)</option>
                    {CELEBRATION_VARIANTS.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </Section>

              <div className="goals-edit-actions">
                {mode.kind === 'edit' && selectedGoal && (
                  <button
                    type="button"
                    className="logout-button goals-edit-delete"
                    onClick={() => void removeGoal(selectedGoal)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                )}
                <span className="goals-edit-actions-spacer" />
                <button
                  type="button"
                  className="logout-button"
                  onClick={cancel}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button type="submit" className="auth-submit" disabled={busy}>
                  {mode.kind === 'create' ? 'Create' : 'Save'}
                </button>
              </div>
            </form>
          )}
        </aside>
      </div>
    </AdminShell>
  );
}

function Section({
  title,
  tail,
  children,
}: {
  title: string;
  tail?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="goals-edit-section">
      <div className="goals-edit-section-head">
        <span className="goals-edit-section-title">{title}</span>
        {tail}
      </div>
      <div className="goals-edit-section-body">{children}</div>
    </section>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="goals-edit-field">
      <span className="goals-edit-field-label">{label}</span>
      {children}
      {help && <span className="goals-edit-field-help">{help}</span>}
    </label>
  );
}
