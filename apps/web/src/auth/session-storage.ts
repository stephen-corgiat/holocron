/**
 * Token storage rules:
 *
 *   admin   → sessionStorage (key `holocron.admin_token`).
 *             Cleared when the browser tab closes; admins re-authenticate per
 *             session. Short-ish JWT TTL (default 12h) limits exposure if a
 *             session does leak.
 *
 *   tablet  → localStorage (key `holocron.tablet_token`). The tablet is a
 *             dedicated household device — the long-lived JWT must survive
 *             reboots and tab closes, so localStorage is the right home.
 *
 * Both surfaces send the token via `Authorization: Bearer <jwt>` (no cookies),
 * so there is no CSRF surface to defend.
 */

const TABLET_KEY = 'holocron.tablet_token';
const ADMIN_KEY = 'holocron.admin_token';

export const tabletTokenStore = {
  get(): string | null {
    return localStorage.getItem(TABLET_KEY);
  },
  set(token: string): void {
    localStorage.setItem(TABLET_KEY, token);
  },
  clear(): void {
    localStorage.removeItem(TABLET_KEY);
  },
};

export const adminTokenStore = {
  get(): string | null {
    return sessionStorage.getItem(ADMIN_KEY);
  },
  set(token: string): void {
    sessionStorage.setItem(ADMIN_KEY, token);
  },
  clear(): void {
    sessionStorage.removeItem(ADMIN_KEY);
  },
};
