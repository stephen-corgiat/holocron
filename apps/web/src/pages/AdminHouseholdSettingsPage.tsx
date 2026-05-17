import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { householdSettingsApi } from '../auth/api';
import { useSettings } from '../settings/SettingsProvider';

/** IANA zones the browser knows, or a small sane fallback for old engines. */
function supportedTimeZones(): string[] {
  const withValues = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  if (typeof withValues.supportedValuesOf === 'function') {
    try {
      return withValues.supportedValuesOf('timeZone');
    } catch {
      /* fall through */
    }
  }
  return [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'Europe/London',
    'Europe/Paris',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];
}

export function AdminHouseholdSettingsPage() {
  const { session } = useAuth();
  const adminToken = session.kind === 'admin' ? session.token : null;
  const { refresh: refreshHouseholdTz } = useSettings();
  const [hours, setHours] = useState<number>(48);
  const [cashOutRate, setCashOutRate] = useState<number>(0.1);
  const [dailyBonusAmount, setDailyBonusAmount] = useState<number>(5);
  const [audibleWarningAt, setAudibleWarningAt] = useState<string>('');
  const [timeZone, setTimeZone] = useState<string>('America/Los_Angeles');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!adminToken) return;
    try {
      const view = await householdSettingsApi.get(adminToken);
      setHours(view.pending_review_timeout_hours);
      setCashOutRate(view.cash_out_rate);
      setDailyBonusAmount(view.daily_bonus_amount);
      setAudibleWarningAt(view.audible_warning_at ?? '');
      setTimeZone(view.time_zone);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load settings');
    }
  }, [adminToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    if (!(hours > 0)) {
      setError('pending review timeout must be greater than zero');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const view = await householdSettingsApi.update(adminToken, {
        pending_review_timeout_hours: hours,
        cash_out_rate: cashOutRate,
        daily_bonus_amount: dailyBonusAmount,
        audible_warning_at: audibleWarningAt.trim() === '' ? null : audibleWarningAt,
        time_zone: timeZone,
      });
      setHours(view.pending_review_timeout_hours);
      setCashOutRate(view.cash_out_rate);
      setDailyBonusAmount(view.daily_bonus_amount);
      setAudibleWarningAt(view.audible_warning_at ?? '');
      setTimeZone(view.time_zone);
      setSavedAt(Date.now());
      // Push the new zone to the rest of the app immediately.
      void refreshHouseholdTz();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  };

  if (session.kind !== 'admin') return null;

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h2>Household settings</h2>
      </div>
      {error && <p className="auth-error">{error}</p>}
      <form className="auth-form trackee-form" onSubmit={submit}>
        <label>
          <span>Time zone</span>
          <input
            type="text"
            list="household-timezones"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            placeholder="America/Los_Angeles"
          />
          <datalist id="household-timezones">
            {supportedTimeZones().map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </label>
        <p className="auth-prose" style={{ fontSize: '0.85em', opacity: 0.7 }}>
          The single civil-time zone for the whole household. All wall-clock
          times — task due times, the tablet clock, day boundaries for streaks
          and goal limits — are interpreted and displayed in this zone,
          regardless of where a device or browser actually sits. Timestamps are
          always stored in UTC.
        </p>

        <label>
          <span>Pending review timeout (hours)</span>
          <input
            type="number"
            min={0.5}
            max={720}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
        </label>
        <p className="auth-prose" style={{ fontSize: '0.85em', opacity: 0.7 }}>
          A pending review older than this auto-rejects (claws back the
          optimistic earn, fires the Miss with all four effects). Default 48h.
        </p>

        <label>
          <span>Cash-out rate (dollars per point)</span>
          <input
            type="number"
            min={0}
            max={10}
            step={0.01}
            value={cashOutRate}
            onChange={(e) => setCashOutRate(Number(e.target.value))}
          />
        </label>
        <p className="auth-prose" style={{ fontSize: '0.85em', opacity: 0.7 }}>
          Display-only conversion for the cash-out UI. The ledger stays in
          points. Default 0.10 ($1 per 10 points).
        </p>

        <label>
          <span>Daily routine streak bonus (points)</span>
          <input
            type="number"
            min={0}
            max={1000}
            step={1}
            value={dailyBonusAmount}
            onChange={(e) => setDailyBonusAmount(Number(e.target.value))}
          />
        </label>
        <p className="auth-prose" style={{ fontSize: '0.85em', opacity: 0.7 }}>
          Points awarded each day a Trackee resolves every routine task and the
          streak advances. Default 5. Set to 0 to disable the bonus.
        </p>

        <label>
          <span>Audible warning time (HH:MM, blank to disable)</span>
          <input
            type="time"
            value={audibleWarningAt}
            onChange={(e) => setAudibleWarningAt(e.target.value)}
          />
        </label>
        <p className="auth-prose" style={{ fontSize: '0.85em', opacity: 0.7 }}>
          The wall tablet plays a chime + shows a banner at this local time if
          any Restrictable Trackee still has an outstanding routine task.
          Restrictable Trackees only; reminders, Excused, Deferred, Pending
          review, and presence-suppressed occurrences are skipped. Fires at
          most once per day.
        </p>
        <div className="form-actions">
          <button type="submit" className="auth-submit" disabled={saving}>
            Save
          </button>
          {savedAt && !saving && (
            <span className="auth-prose" style={{ opacity: 0.6 }}>
              Saved.
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
