import { useState } from 'react';
import { authApi, EnrollmentCodeResponse } from '../auth/api';
import { useAuth } from '../auth/AuthProvider';
import { useHouseholdTimeZone } from '../settings/SettingsProvider';

export function AdminEnrollTabletPage() {
  const { session } = useAuth();
  const tz = useHouseholdTimeZone();
  const [code, setCode] = useState<EnrollmentCodeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.kind !== 'admin') return null;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setCode(await authApi.createEnrollmentCode(session.token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to mint code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-section">
      <h2>Enroll a household tablet</h2>
      <p className="auth-prose">
        Generate a one-time code, then walk to the tablet, open the app, and
        enter the code on the enrollment screen. The code expires in five
        minutes and can only be redeemed once.
      </p>
      <button
        type="button"
        className="auth-submit"
        onClick={generate}
        disabled={busy}
      >
        {busy ? 'Generating…' : code ? 'Generate a new code' : 'Generate code'}
      </button>
      {error && <p className="auth-error">{error}</p>}
      {code && (
        <div className="enrollment-code-display">
          <div className="enrollment-code">{code.code}</div>
          <div className="enrollment-expiry">
            expires{' '}
            {new Date(code.expires_at).toLocaleTimeString(undefined, {
              timeZone: tz,
              hour12: true,
            })}
          </div>
        </div>
      )}
    </section>
  );
}
