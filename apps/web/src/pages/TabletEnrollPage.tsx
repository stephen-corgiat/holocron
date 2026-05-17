import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../auth/api';
import { useAuth } from '../auth/AuthProvider';

export function TabletEnrollPage() {
  const { installTabletToken } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await authApi.redeemEnrollmentCode(code.trim());
      await installTabletToken(token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'enrollment failed — ask an admin for a fresh code',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <header>
          <span className="wordmark">HOLOCRON</span>
          <span className="slogan">Tablet enrollment</span>
        </header>
        <p className="auth-prose">
          Enter the one-time code an admin generated for this device.
        </p>
        <form onSubmit={onSubmit} className="auth-form">
          <label>
            <span>Enrollment code</span>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              required
              autoFocus
              spellCheck={false}
              style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.2em' }}
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? 'Enrolling…' : 'Enroll this tablet'}
          </button>
        </form>
        <p className="auth-aside">
          Are you an admin? <Link to="/login">Sign in instead.</Link>
        </p>
      </div>
    </div>
  );
}
