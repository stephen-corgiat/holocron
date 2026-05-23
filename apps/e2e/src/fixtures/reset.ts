import type { ApiClient } from './api-client';

export interface SeedFloor {
  adminUserId: string;
  adminToken: string;
  tabletToken: string;
  trackeeUserId: string;
  enrollmentCode: string;
  categoryId: string;
}

interface RawSeed {
  admin_user_id: string;
  admin_token: string;
  tablet_token: string;
  trackee_user_id: string;
  enrollment_code: string;
  category_id: string;
}

/**
 * Truncate the DB and seed the floor: Alice (admin) + Bob (Restrictable
 * Trackee). Returns tokens + ids so the test can act without re-hitting the
 * login flow on every case.
 */
export async function reset(api: ApiClient): Promise<SeedFloor> {
  const raw = await api.post<RawSeed>('/_e2e/reset');
  return {
    adminUserId: raw.admin_user_id,
    adminToken: raw.admin_token,
    tabletToken: raw.tablet_token,
    trackeeUserId: raw.trackee_user_id,
    enrollmentCode: raw.enrollment_code,
    categoryId: raw.category_id,
  };
}
