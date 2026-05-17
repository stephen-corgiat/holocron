export interface AdminLoginResponse {
  token: string;
  user: {
    id: string;
    username: string;
    display_name: string;
    is_admin: boolean;
  };
}

export interface EnrollmentCodeResponse {
  code: string;
  expires_at: string;
}

export interface EnrollmentRedeemResponse {
  token: string;
  enrolled_by: string;
}

export type WhoamiResponse =
  | {
      kind: 'admin';
      is_admin: true;
      user: AdminLoginResponse['user'] | null;
    }
  | {
      kind: 'tablet';
      is_admin: false;
      enrolled_by: string;
    };

export interface TrackeeView {
  id: string;
  display_name: string;
  is_admin: boolean;
  is_restrictable: boolean;
  router_id: string | null;
  avatar: string | null;
  color: string | null;
  username: string | null;
  deactivated_at: string | null;
  created_at: string;
  /** Daily-routine streak count surfaced for the tablet header pill. */
  current_streak?: number;
}

export interface CreateTrackeePayload {
  display_name: string;
  is_admin: boolean;
  is_restrictable: boolean;
  router_id?: string;
  avatar?: string | null;
  color?: string | null;
  password?: string;
  username?: string;
}

export interface UpdateTrackeePayload {
  display_name?: string;
  is_admin?: boolean;
  is_restrictable?: boolean;
  router_id?: string;
  avatar?: string | null;
  color?: string | null;
  password?: string;
  username?: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  if (init.body) headers.set('Content-Type', 'application/json');

  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const authApi = {
  loginAdmin(username: string, password: string): Promise<AdminLoginResponse> {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  whoami(token: string): Promise<WhoamiResponse> {
    return request('/auth/whoami', { method: 'GET', token });
  },
  createEnrollmentCode(adminToken: string): Promise<EnrollmentCodeResponse> {
    return request('/auth/tablet/enrollment-code', {
      method: 'POST',
      token: adminToken,
    });
  },
  redeemEnrollmentCode(code: string): Promise<EnrollmentRedeemResponse> {
    return request('/auth/tablet/enroll', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },
};

export type TaskKind = 'reminder' | 'recurring' | 'windowed';

export type RecurrencePreset =
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'weekly'
  | 'biweekly'
  | 'every_n_days'
  | 'every_n_weeks'
  | 'every_n_months'
  | 'yearly_on_date'
  | 'yearly_in_month';

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RecurrencePattern =
  | { preset: 'daily' }
  | { preset: 'weekdays' }
  | { preset: 'weekends' }
  | { preset: 'weekly'; days: DayOfWeek[] }
  | { preset: 'biweekly'; days: DayOfWeek[]; anchor: string }
  | { preset: 'every_n_days'; n: number; anchor: string }
  | { preset: 'every_n_weeks'; n: number; days: DayOfWeek[]; anchor: string }
  | { preset: 'every_n_months'; n: number; day_of_month: number; anchor: string }
  | { preset: 'yearly_on_date'; month: number; day: number }
  | { preset: 'yearly_in_month'; month: number; ordinal: number; day_of_week: DayOfWeek };

export type RestrictionScope = 'internet' | 'entertainment' | 'games';

export interface RestrictionSpec {
  type: RestrictionScope;
  duration_minutes?: number | null;
  remediation_goal_ids?: string[] | null;
}

export interface Tier {
  points: number;
  restriction: RestrictionSpec | null;
}

export type Ladder = Tier[];

export interface TaskView {
  id: string;
  kind: TaskKind;
  name: string;
  icon: string | null;
  due_time: string; // HH:MM
  recurrence: RecurrencePattern | null;
  points: number;
  ladder: Ladder;
  ladder_reset_threshold: number;
  active: boolean;
  requires_verification: boolean;
  allow_late_completion: boolean;
  late_window_minutes: number;
  window_start_offset_minutes: number | null;
  window_end_offset_minutes: number | null;
  created_at: string;
  assignee_ids: string[];
}

// Back-compat alias from when reminders were the only task kind.
export type ReminderTaskView = TaskView;

export interface CreateReminderTaskPayload {
  name: string;
  icon?: string | null;
  due_time: string;
  // Same cadence vocabulary as recurring tasks. Omit/null = fire daily.
  recurrence?: RecurrencePattern | null;
  active?: boolean;
  assignee_ids: string[];
}

export interface UpdateReminderTaskPayload {
  name?: string;
  icon?: string | null;
  due_time?: string;
  recurrence?: RecurrencePattern | null;
  active?: boolean;
  assignee_ids?: string[];
}

export interface CreateRecurringTaskPayload {
  name: string;
  icon?: string | null;
  due_time: string;
  recurrence: RecurrencePattern;
  points: number;
  ladder?: Ladder;
  ladder_reset_threshold?: number;
  active?: boolean;
  requires_verification?: boolean;
  allow_late_completion?: boolean;
  late_window_minutes?: number;
  assignee_ids: string[];
}

export interface UpdateRecurringTaskPayload {
  name?: string;
  icon?: string | null;
  due_time?: string;
  recurrence?: RecurrencePattern;
  points?: number;
  ladder?: Ladder;
  ladder_reset_threshold?: number;
  active?: boolean;
  requires_verification?: boolean;
  allow_late_completion?: boolean;
  late_window_minutes?: number;
  assignee_ids?: string[];
}

export interface CreateWindowedTaskPayload {
  name: string;
  icon?: string | null;
  // Recurring case: supply `recurrence` + offsets (minutes from cadence anchor).
  // One-shot case: omit `recurrence` and supply `window_start` / `window_end`.
  recurrence?: RecurrencePattern | null;
  window_start_offset_minutes?: number;
  window_end_offset_minutes?: number;
  window_start?: string;
  window_end?: string;
  points: number;
  ladder?: Ladder;
  ladder_reset_threshold?: number;
  active?: boolean;
  requires_verification?: boolean;
  assignee_ids: string[];
}

export interface UpdateWindowedTaskPayload {
  name?: string;
  icon?: string | null;
  recurrence?: RecurrencePattern | null;
  window_start_offset_minutes?: number;
  window_end_offset_minutes?: number;
  points?: number;
  ladder?: Ladder;
  ladder_reset_threshold?: number;
  active?: boolean;
  requires_verification?: boolean;
  assignee_ids?: string[];
}

export type OccurrenceBucket = 'morning' | 'after_school' | 'evening';

export interface OccurrenceView {
  id: string;
  task_id: string;
  user_id: string;
  scheduled_at: string;
  task_name: string;
  task_icon: string | null;
  task_kind: TaskKind;
  task_points: number;
  bucket: OccurrenceBucket;
  // Wall-clock time (12-hour, e.g. `4:45 PM`) of scheduled_at in the household
  // time zone. Render this verbatim — deriving the time from scheduled_at in
  // the browser's own zone drifts when the tablet/browser zone differs from
  // the household's.
  display_time: string;
  auto_complete: boolean;
  status:
    | 'active'
    | 'auto_complete'
    | 'complete'
    | 'pending_review'
    | 'excused'
    | 'missed';
  late_complete_until?: string;
  // ADR-0003: derived on read. When true, the tablet renders an Away badge
  // and the occurrence is treated as Excused for rule purposes.
  presence_suppressed?: boolean;
  // Windowed-only: ISO instant when the window closes (and Miss fires).
  // scheduled_at carries the window-start instant.
  window_end?: string;
  // Windowed-only: wall-clock time (12-hour, e.g. `4:45 PM`) of window_end in
  // the household tz.
  window_end_display?: string;
}

export const tasksApi = {
  // Every task kind in one list — feeds the unified Task editor's left rail.
  listAll(adminToken: string): Promise<{ tasks: TaskView[] }> {
    return request('/tasks', { method: 'GET', token: adminToken });
  },
  listReminders(adminToken: string): Promise<{ tasks: TaskView[] }> {
    return request('/tasks?kind=reminder', { method: 'GET', token: adminToken });
  },
  listRecurring(adminToken: string): Promise<{ tasks: TaskView[] }> {
    return request('/tasks?kind=recurring', { method: 'GET', token: adminToken });
  },
  create(
    adminToken: string,
    payload: CreateReminderTaskPayload,
  ): Promise<TaskView> {
    return request('/tasks', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify(payload),
    });
  },
  update(
    adminToken: string,
    id: string,
    payload: UpdateReminderTaskPayload,
  ): Promise<TaskView> {
    return request(`/tasks/${id}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify(payload),
    });
  },
  createRecurring(
    adminToken: string,
    payload: CreateRecurringTaskPayload,
  ): Promise<TaskView> {
    return request('/tasks/recurring', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify(payload),
    });
  },
  updateRecurring(
    adminToken: string,
    id: string,
    payload: UpdateRecurringTaskPayload,
  ): Promise<TaskView> {
    return request(`/tasks/recurring/${id}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify(payload),
    });
  },
  listWindowed(adminToken: string): Promise<{ tasks: TaskView[] }> {
    return request('/tasks?kind=windowed', { method: 'GET', token: adminToken });
  },
  createWindowed(
    adminToken: string,
    payload: CreateWindowedTaskPayload,
  ): Promise<TaskView> {
    return request('/tasks/windowed', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify(payload),
    });
  },
  updateWindowed(
    adminToken: string,
    id: string,
    payload: UpdateWindowedTaskPayload,
  ): Promise<TaskView> {
    return request(`/tasks/windowed/${id}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify(payload),
    });
  },
  remove(adminToken: string, id: string): Promise<void> {
    return request(`/tasks/${id}`, { method: 'DELETE', token: adminToken });
  },
};

export const occurrencesApi = {
  forTrackee(
    token: string,
    userId: string,
    date?: string,
  ): Promise<{ occurrences: OccurrenceView[] }> {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return request(`/occurrences/trackee/${userId}${qs}`, {
      method: 'GET',
      token,
    });
  },
  // Windowed occurrences whose window opens within the next 24h (for the
  // tablet's "Up next" rail).
  upNext(
    token: string,
    userId: string,
  ): Promise<{ occurrences: OccurrenceView[] }> {
    return request(`/occurrences/trackee/${userId}/up-next`, {
      method: 'GET',
      token,
    });
  },
  complete(token: string, id: string): Promise<{ id: string; status: 'complete' }> {
    return request(`/occurrences/${id}/complete`, {
      method: 'POST',
      token,
    });
  },
  lateComplete(
    token: string,
    id: string,
  ): Promise<{ id: string; status: 'complete' }> {
    return request(`/occurrences/${id}/late-complete`, {
      method: 'POST',
      token,
    });
  },
};

export type TransactionKindView =
  | 'earn'
  | 'penalty'
  | 'claw_back'
  | 'adjustment'
  | 'withdrawal';

export interface TransactionView {
  id: string;
  user_id: string;
  kind: TransactionKindView;
  amount: number;
  reason: string | null;
  admin_user_id: string | null;
  occurrence_id: string | null;
  goal_completion_id: string | null;
  created_at: string;
}

export interface CashOutRequestView {
  id: string;
  user_id: string;
  user_display_name: string;
  requested_amount: number;
  status: 'pending' | 'committed' | 'rejected';
  admin_user_id: string | null;
  committed_transaction_id: string | null;
  decided_at: string | null;
  created_at: string;
}

export const transactionsApi = {
  balance(
    token: string,
    userId: string,
  ): Promise<{
    user_id: string;
    balance: number;
    cash_out_rate: number;
    pending_cash_out: boolean;
  }> {
    return request(`/transactions/trackee/${userId}/balance`, {
      method: 'GET',
      token,
    });
  },
  history(
    token: string,
    userId: string,
    bucket: 'all' | 'earned' | 'spent' = 'all',
    opts: { from?: string; to?: string; limit?: number } = {},
  ): Promise<{ transactions: TransactionView[] }> {
    const qs = new URLSearchParams();
    if (bucket && bucket !== 'all') qs.set('bucket', bucket);
    if (opts.from) qs.set('from', opts.from);
    if (opts.to) qs.set('to', opts.to);
    if (opts.limit) qs.set('limit', String(opts.limit));
    const tail = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/transactions/trackee/${userId}/history${tail}`, {
      method: 'GET',
      token,
    });
  },
  // Admin
  adjustBalance(
    token: string,
    userId: string,
    amount: number,
    reason: string | null,
  ): Promise<TransactionView> {
    return request('/admin/transactions/adjust', {
      method: 'POST',
      token,
      body: JSON.stringify({ user_id: userId, amount, reason }),
    });
  },
  adminCashOut(
    token: string,
    userId: string,
    amount: number,
  ): Promise<TransactionView> {
    return request('/admin/transactions/cash-out/commit', {
      method: 'POST',
      token,
      body: JSON.stringify({ user_id: userId, amount }),
    });
  },
  listCashOutRequests(
    token: string,
  ): Promise<{ requests: CashOutRequestView[] }> {
    return request('/admin/transactions/cash-out/requests', {
      method: 'GET',
      token,
    });
  },
  commitCashOutRequest(token: string, id: string): Promise<TransactionView> {
    return request(`/admin/transactions/cash-out/requests/${id}/commit`, {
      method: 'POST',
      token,
    });
  },
  rejectCashOutRequest(token: string, id: string): Promise<CashOutRequestView> {
    return request(`/admin/transactions/cash-out/requests/${id}/reject`, {
      method: 'POST',
      token,
    });
  },
  // Tablet
  createCashOutRequest(
    token: string,
    userId: string,
    amount: number,
  ): Promise<{ id: string; status: 'pending' }> {
    return request('/transactions/cash-out/request', {
      method: 'POST',
      token,
      body: JSON.stringify({ user_id: userId, amount }),
    });
  },
};

export interface PendingCard {
  occurrence_id: string;
  task_id: string;
  task_name: string;
  task_icon: string | null;
  task_points: number;
  user_id: string;
  user_display_name: string;
  scheduled_at: string;
  pending_since: string;
}

export interface AdminOccurrenceRow {
  id: string;
  task_id: string;
  task_name: string;
  task_icon: string | null;
  task_points: number;
  user_id: string;
  scheduled_at: string;
  status:
    | 'active'
    | 'excused'
    | 'deferred'
    | 'complete'
    | 'missed'
    | 'pending_review';
  deferred_from_occurrence_id: string | null;
}

export const adminOccurrencesApi = {
  forTrackee(
    adminToken: string,
    userId: string,
    opts: { from?: string; to?: string } = {},
  ): Promise<{ occurrences: AdminOccurrenceRow[] }> {
    const qs = new URLSearchParams();
    if (opts.from) qs.set('from', opts.from);
    if (opts.to) qs.set('to', opts.to);
    const tail = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/admin/occurrences/trackee/${userId}${tail}`, {
      method: 'GET',
      token: adminToken,
    });
  },
  excuse(
    adminToken: string,
    occurrenceId: string,
  ): Promise<{ id: string; status: 'excused' }> {
    return request(`/admin/occurrences/${occurrenceId}/excuse`, {
      method: 'POST',
      token: adminToken,
    });
  },
  defer(
    adminToken: string,
    occurrenceId: string,
    date: string,
  ): Promise<{
    id: string;
    status: 'deferred';
    deferred_occurrence_id: string;
  }> {
    return request(`/admin/occurrences/${occurrenceId}/defer`, {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ date }),
    });
  },
};

export const pendingReviewApi = {
  list(adminToken: string): Promise<{ pending: PendingCard[] }> {
    return request('/admin/pending-review', { method: 'GET', token: adminToken });
  },
  approve(
    adminToken: string,
    occurrenceId: string,
  ): Promise<{ id: string; status: 'complete' }> {
    return request(`/admin/pending-review/${occurrenceId}/approve`, {
      method: 'POST',
      token: adminToken,
    });
  },
  reject(
    adminToken: string,
    occurrenceId: string,
  ): Promise<{ id: string; status: 'missed' }> {
    return request(`/admin/pending-review/${occurrenceId}/reject`, {
      method: 'POST',
      token: adminToken,
    });
  },
  approveAll(adminToken: string): Promise<{ approved: number }> {
    return request('/admin/pending-review/approve-all', {
      method: 'POST',
      token: adminToken,
    });
  },
};

export interface HouseholdSettingsView {
  pending_review_timeout_hours: number;
  time_zone: string;
  cash_out_rate: number;
  audible_warning_at: string | null;
  daily_bonus_amount: number;
}

export interface HouseholdSettingsPayload {
  pending_review_timeout_hours?: number;
  cash_out_rate?: number;
  audible_warning_at?: string | null;
  time_zone?: string;
  daily_bonus_amount?: number;
}

export const householdSettingsApi = {
  get(adminToken: string): Promise<HouseholdSettingsView> {
    return request('/admin/settings/household', {
      method: 'GET',
      token: adminToken,
    });
  },
  update(
    adminToken: string,
    payload: HouseholdSettingsPayload,
  ): Promise<HouseholdSettingsView> {
    return request('/admin/settings/household', {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify(payload),
    });
  },
};

export interface PublicSettingsView {
  time_zone: string;
}

export const publicSettingsApi = {
  /** Display-only settings readable by any session (incl. the tablet token). */
  get(token: string): Promise<PublicSettingsView> {
    return request('/settings/public', { method: 'GET', token });
  },
};

export type LimitWindow = 'day' | 'week' | 'month' | 'lifetime';

export interface CategoryView {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface GoalView {
  id: string;
  name: string;
  icon: string | null;
  note: string | null;
  category_id: string;
  kind: 'flat' | 'tiered';
  points: number;
  tier_values: number[];
  completion_limit: number;
  limit_window: LimitWindow;
  show_in_catalog: boolean;
  usable_as_remediation: boolean;
  assigned_to_user_id: string | null;
  active: boolean;
  celebration_variant_id: string | null;
  created_at: string;
}

export interface CatalogGoalView extends GoalView {
  remaining: number;
  maxed_out: boolean;
}

export interface CreateCategoryPayload {
  name: string;
  sort_order?: number;
}

export interface UpdateCategoryPayload {
  name?: string;
  sort_order?: number;
}

export interface CreateGoalPayload {
  name: string;
  icon?: string | null;
  note?: string | null;
  category_id: string;
  kind?: 'flat' | 'tiered';
  points?: number;
  tier_values?: number[];
  completion_limit: number;
  limit_window: LimitWindow;
  show_in_catalog?: boolean;
  usable_as_remediation?: boolean;
  assigned_to_user_id?: string | null;
  active?: boolean;
  celebration_variant_id?: string | null;
}

export interface UpdateGoalPayload {
  name?: string;
  icon?: string | null;
  note?: string | null;
  category_id?: string;
  kind?: 'flat' | 'tiered';
  points?: number;
  tier_values?: number[];
  completion_limit?: number;
  limit_window?: LimitWindow;
  show_in_catalog?: boolean;
  usable_as_remediation?: boolean;
  assigned_to_user_id?: string | null;
  active?: boolean;
  celebration_variant_id?: string | null;
}

export const categoriesApi = {
  list(token: string): Promise<{ categories: CategoryView[] }> {
    return request('/categories', { method: 'GET', token });
  },
  create(token: string, payload: CreateCategoryPayload): Promise<CategoryView> {
    return request('/categories', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    });
  },
  update(
    token: string,
    id: string,
    payload: UpdateCategoryPayload,
  ): Promise<CategoryView> {
    return request(`/categories/${id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(payload),
    });
  },
  remove(token: string, id: string): Promise<void> {
    return request(`/categories/${id}`, { method: 'DELETE', token });
  },
};

export const goalsApi = {
  list(token: string): Promise<{ goals: GoalView[] }> {
    return request('/goals', { method: 'GET', token });
  },
  create(token: string, payload: CreateGoalPayload): Promise<GoalView> {
    return request('/goals', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    });
  },
  update(
    token: string,
    id: string,
    payload: UpdateGoalPayload,
  ): Promise<GoalView> {
    return request(`/goals/${id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(payload),
    });
  },
  remove(token: string, id: string): Promise<void> {
    return request(`/goals/${id}`, { method: 'DELETE', token });
  },
  catalog(
    token: string,
    userId: string,
  ): Promise<{ goals: CatalogGoalView[] }> {
    return request(`/goals/catalog?user_id=${encodeURIComponent(userId)}`, {
      method: 'GET',
      token,
    });
  },
  complete(
    token: string,
    goalId: string,
    userId: string,
    tierValue?: number,
    restrictionId?: string,
  ): Promise<{
    completion_id: string;
    amount: number;
    lifted_restriction_id: string | null;
  }> {
    const body: {
      user_id: string;
      tier_value?: number;
      restriction_id?: string;
    } = { user_id: userId };
    if (tierValue !== undefined) body.tier_value = tierValue;
    if (restrictionId !== undefined) body.restriction_id = restrictionId;
    return request(`/goals/${goalId}/complete`, {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    });
  },
  listFavorites(
    token: string,
    userId: string,
  ): Promise<{ goal_ids: string[] }> {
    return request(`/goals/favorites?user_id=${encodeURIComponent(userId)}`, {
      method: 'GET',
      token,
    });
  },
  setFavorite(
    token: string,
    goalId: string,
    userId: string,
    favorite: boolean,
  ): Promise<void> {
    return request(
      `/goals/${goalId}/favorite?user_id=${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        token,
        body: JSON.stringify({ favorite }),
      },
    );
  },
  listInProgress(
    token: string,
    userId: string,
  ): Promise<{ items: { goal_id: string; started_at: string }[] }> {
    return request(
      `/goals/in-progress?user_id=${encodeURIComponent(userId)}`,
      { method: 'GET', token },
    );
  },
  addInProgress(
    token: string,
    goalId: string,
    userId: string,
  ): Promise<void> {
    return request(
      `/goals/${goalId}/in-progress?user_id=${encodeURIComponent(userId)}`,
      { method: 'POST', token },
    );
  },
  removeInProgress(
    token: string,
    goalId: string,
    userId: string,
  ): Promise<void> {
    return request(
      `/goals/${goalId}/in-progress?user_id=${encodeURIComponent(userId)}`,
      { method: 'DELETE', token },
    );
  },
  recentCompletions(
    token: string,
    userId: string,
    limit = 3,
  ): Promise<{ goal_ids: string[] }> {
    return request(
      `/goals/recent-completions?user_id=${encodeURIComponent(userId)}&limit=${limit}`,
      { method: 'GET', token },
    );
  },
};

// --- Restrictions (ADR-0004) ---

export type CauseKind = 'miss' | 'admin';

export interface RestrictionCauseView {
  id: string;
  kind: CauseKind;
  occurrence_id: string | null;
  admin_user_id: string | null;
  reason: string | null;
  contributed_expires_at: string | null;
  contributed_remediation_goals: string[] | null;
  parent_only_on_expiry: boolean;
  parent_only_on_remediation: boolean;
  created_at: string;
  occurrence_task_name?: string | null;
}

export interface AdminRestrictionView {
  id: string;
  user_id: string;
  user_display_name: string;
  scope: RestrictionScope;
  effective_expires_at: string | null;
  effective_remediation_goals: string[];
  created_at: string;
  causes: RestrictionCauseView[];
}

export interface ScopeSummary {
  scope: RestrictionScope;
  blocked_user_ids: string[];
  total_restrictable: number;
}

export interface RemediationRequestView {
  id: string;
  user_id: string;
  user_display_name: string;
  restriction_id: string;
  scope: RestrictionScope;
  note: string | null;
  created_at: string;
}

export interface EnforcementLogView {
  id: string;
  restriction_id: string | null;
  user_id: string;
  backend: 'router' | 'pihole';
  scope: RestrictionScope;
  action: 'add' | 'del';
  /** CSV of IPs (router) or single MAC (pihole); null on skipped rows. */
  target_address: string | null;
  result: 'ok' | 'error' | 'skipped';
  http_status: number | null;
  error: string | null;
  created_at: string;
}

export interface RestrictionsOverviewResponse {
  scopes: ScopeSummary[];
  active: AdminRestrictionView[];
  remediation_requests: RemediationRequestView[];
  enforcement_log: EnforcementLogView[];
}

export interface ActiveRestrictionByScope {
  id: string;
  scope: RestrictionScope;
  effective_expires_at: string | null;
  effective_remediation_goals: string[];
  causes: RestrictionCauseView[];
}

export interface TabletRestrictionView {
  user_id: string;
  active: ActiveRestrictionByScope[];
}

export const restrictionsApi = {
  overview(adminToken: string): Promise<RestrictionsOverviewResponse> {
    return request('/admin/restrictions', {
      method: 'GET',
      token: adminToken,
    });
  },
  blockNow(
    adminToken: string,
    payload: { user_id: string; scope: RestrictionScope; reason?: string },
  ): Promise<{ id: string }> {
    return request('/admin/restrictions/block-now', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify(payload),
    });
  },
  lift(adminToken: string, id: string): Promise<{ id: string; lifted: true }> {
    return request(`/admin/restrictions/${id}/lift`, {
      method: 'POST',
      token: adminToken,
    });
  },
  resolveRequest(
    adminToken: string,
    id: string,
  ): Promise<{ id: string; status: 'resolved' }> {
    return request(
      `/admin/restrictions/remediation-requests/${id}/resolve`,
      { method: 'POST', token: adminToken },
    );
  },
  forTrackee(token: string, userId: string): Promise<TabletRestrictionView> {
    return request(`/restrictions/trackee/${userId}`, {
      method: 'GET',
      token,
    });
  },
  activeUsers(
    token: string,
  ): Promise<{ users: Array<{ user_id: string; has_active: boolean }> }> {
    return request('/restrictions/active-users', {
      method: 'GET',
      token,
    });
  },
  askParent(
    token: string,
    payload: { user_id: string; scope: RestrictionScope; note?: string },
  ): Promise<{ id: string; status: 'open' }> {
    return request('/restrictions/remediation-requests', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    });
  },
};

export const usersApi = {
  roster(token: string): Promise<{ trackees: TrackeeView[] }> {
    return request('/users/roster', { method: 'GET', token });
  },
  list(adminToken: string): Promise<{ trackees: TrackeeView[] }> {
    return request('/users', { method: 'GET', token: adminToken });
  },
  create(adminToken: string, payload: CreateTrackeePayload): Promise<TrackeeView> {
    return request('/users', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify(payload),
    });
  },
  update(
    adminToken: string,
    id: string,
    payload: UpdateTrackeePayload,
  ): Promise<TrackeeView> {
    return request(`/users/${id}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify(payload),
    });
  },
  deactivate(adminToken: string, id: string): Promise<TrackeeView> {
    return request(`/users/${id}/deactivate`, {
      method: 'POST',
      token: adminToken,
    });
  },
};

export interface DeviceView {
  id: string;
  user_id: string;
  display_name: string;
  ip_address: string | null;
  mac_address: string | null;
  created_at: string;
}

export interface DevicePayload {
  display_name: string;
  ip_address?: string | null;
  mac_address?: string | null;
}

export const devicesApi = {
  list(adminToken: string, userId: string): Promise<{ devices: DeviceView[] }> {
    return request(`/users/${userId}/devices`, {
      method: 'GET',
      token: adminToken,
    });
  },
  create(
    adminToken: string,
    userId: string,
    payload: DevicePayload,
  ): Promise<DeviceView> {
    return request(`/users/${userId}/devices`, {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify(payload),
    });
  },
  update(
    adminToken: string,
    userId: string,
    deviceId: string,
    payload: DevicePayload,
  ): Promise<DeviceView> {
    return request(`/users/${userId}/devices/${deviceId}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify(payload),
    });
  },
  remove(adminToken: string, userId: string, deviceId: string): Promise<void> {
    return request(`/users/${userId}/devices/${deviceId}`, {
      method: 'DELETE',
      token: adminToken,
    });
  },
};

export type PresenceRuleKind = 'none' | 'full_time' | 'n_week_grid';

export interface PresenceGridCell {
  kind: 'home' | 'away';
  handoff_time?: string;
}

export type PresenceGridCells = PresenceGridCell[][];

export interface OneOffWindow {
  start: string; // ISO YYYY-MM-DD
  end: string;   // ISO YYYY-MM-DD
  label: string;
}

export interface PresenceScheduleView {
  user_id: string;
  display_name: string;
  is_admin: boolean;
  is_restrictable: boolean;
  recurring_rule_kind: PresenceRuleKind;
  grid_n_weeks: number | null;
  epoch_date: string | null;
  grid_cells: PresenceGridCells | null;
  one_off_windows: OneOffWindow[];
}

export interface PresenceUpdate {
  recurring_rule_kind: PresenceRuleKind;
  grid_n_weeks?: number | null;
  epoch_date?: string | null;
  grid_cells?: PresenceGridCells | null;
}

export interface TabletPresenceView {
  user_id: string;
  is_home: boolean;
  next_vacation: { start: string; end: string; label: string } | null;
}

export const presenceApi = {
  forTrackee(
    token: string,
    userId: string,
  ): Promise<TabletPresenceView> {
    return request(`/presence/trackee/${userId}`, { method: 'GET', token });
  },
  list(adminToken: string): Promise<{ schedules: PresenceScheduleView[] }> {
    return request('/admin/presence', { method: 'GET', token: adminToken });
  },
  setKind(
    adminToken: string,
    userId: string,
    kind: PresenceRuleKind,
  ): Promise<PresenceScheduleView> {
    return request(`/admin/presence/${userId}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ recurring_rule_kind: kind }),
    });
  },
  update(
    adminToken: string,
    userId: string,
    body: PresenceUpdate,
  ): Promise<PresenceScheduleView> {
    return request(`/admin/presence/${userId}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify(body),
    });
  },
  addVacations(
    adminToken: string,
    userId: string,
    windows: OneOffWindow[],
  ): Promise<PresenceScheduleView> {
    return request(`/admin/presence/${userId}/vacations`, {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ windows }),
    });
  },
};
