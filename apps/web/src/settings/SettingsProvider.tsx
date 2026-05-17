import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useAuth } from '../auth/AuthProvider';
import { publicSettingsApi } from '../auth/api';

/**
 * Mirrors the API default (`DEFAULT_TIME_ZONE`). Used until the household
 * setting loads, and for anonymous routes (login / enroll) that render no
 * household-local times anyway.
 */
export const FALLBACK_TIME_ZONE = 'America/Los_Angeles';

interface SettingsContextValue {
  /** Household civil-time zone — feed this to every `lib/datetime` helper. */
  timeZone: string;
  /** Re-fetch after an admin edits the zone. */
  refresh: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Loads the household time zone once a session exists and exposes it to the
 * whole tree. Any authenticated token (admin or wall-tablet) can read it via
 * the public settings endpoint.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const token = session.kind === 'anonymous' ? null : session.token;
  const [timeZone, setTimeZone] = useState<string>(FALLBACK_TIME_ZONE);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const { time_zone } = await publicSettingsApi.get(token);
      if (time_zone) setTimeZone(time_zone);
    } catch {
      // Keep the last-known/fallback zone; a transient fetch failure should
      // never blank out the UI's clock.
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SettingsContext.Provider value={{ timeZone, refresh }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return ctx;
}

/** Convenience: just the household time zone. */
export function useHouseholdTimeZone(): string {
  return useSettings().timeZone;
}
