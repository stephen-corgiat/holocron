/**
 * Shapes for the two session JWTs.
 *
 *   admin   → an authenticated admin browser session bound to one user.
 *             Carries `is_admin: true`. Short-ish lifetime; users re-log on expiry.
 *   tablet  → the household-tablet session. NOT bound to a user; instead
 *             authorized to *act as* any household trackee via the active-tab
 *             selector. Long-lived. Never carries `is_admin: true`.
 */

export type SessionKind = 'admin' | 'tablet';

export interface AdminJwtPayload {
  sub: string;
  kind: 'admin';
  is_admin: true;
  username: string;
}

export interface TabletJwtPayload {
  sub: string;
  kind: 'tablet';
  is_admin: false;
  enrolled_by: string;
}

export type SessionJwtPayload = AdminJwtPayload | TabletJwtPayload;
