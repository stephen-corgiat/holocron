import type { ApiClient } from './api-client';

interface TaskFactoryInput {
  name?: string;
  kind?: 'reminder' | 'recurring';
  due_time?: string;
  points?: number;
  ladder?: Array<{
    points: number;
    restriction?: {
      type: 'internet' | 'entertainment' | 'games';
      duration_minutes?: number | null;
      remediation_goal_ids?: string[] | null;
    } | null;
  }>;
  requires_verification?: boolean;
  allow_late_completion?: boolean;
  late_window_minutes?: number;
  active?: boolean;
  assignee_ids: string[];
  generate_for_today?: boolean;
}

interface GoalFactoryInput {
  name?: string;
  category_id: string;
  kind?: 'flat' | 'tiered';
  points?: number;
  tier_values?: number[];
  completion_limit?: number;
  limit_window?: 'day' | 'week' | 'month' | 'lifetime';
  show_in_catalog?: boolean;
  usable_as_remediation?: boolean;
  assigned_to_user_id?: string | null;
}

interface TrackeeFactoryInput {
  display_name?: string;
  is_admin?: boolean;
  is_restrictable?: boolean;
  color?: string;
  device?: {
    display_name?: string;
    ip_address?: string;
    mac_address?: string;
  };
}

export function factoriesFixture(api: ApiClient) {
  return {
    async createTrackee(input: TrackeeFactoryInput = {}) {
      return api.post<{
        id: string;
        display_name: string;
        device_id: string | null;
      }>('/_e2e/factory/trackee', input);
    },
    async createTask(input: TaskFactoryInput) {
      return api.post<{ id: string; due_time: string }>(
        '/_e2e/factory/task',
        input,
      );
    },
    async createGoal(input: GoalFactoryInput) {
      return api.post<{ id: string; name: string }>(
        '/_e2e/factory/goal',
        input,
      );
    },
    async adjustBalance(input: {
      user_id: string;
      amount: number;
      reason?: string;
    }) {
      await api.post('/_e2e/factory/adjust-balance', input);
    },
    async generateOccurrences() {
      await api.post('/_e2e/occurrences/generate');
    },
  };
}

export type FactoriesFixture = ReturnType<typeof factoriesFixture>;
