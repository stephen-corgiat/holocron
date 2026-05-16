/**
 * Render an error — or a WS `error`/`ErrorEvent` — with its full `cause` chain.
 *
 * undici (Node's built-in `fetch`/`WebSocket`) surfaces an opaque top-level
 * message ("fetch failed", an empty WS event) and stashes the real reason —
 * `ECONNREFUSED`, `ENOTFOUND`, a TLS handshake failure, a socket timeout — on
 * `.cause`. The bare `.message` therefore tells you nothing about *why* the HA
 * link is down. This unwraps every link in the chain and appends each `code`
 * so the log names the actual transport failure (e.g.
 * `fetch failed ← connect ECONNREFUSED 192.0.2.10:8123 (ECONNREFUSED)`).
 */
export function describeHaError(err: unknown): string {
  // A WS `error` event carries the underlying Error on `.error`; unwrap to it.
  if (
    err &&
    typeof err === 'object' &&
    !(err instanceof Error) &&
    'error' in err &&
    (err as { error?: unknown }).error
  ) {
    err = (err as { error: unknown }).error;
  }

  const parts: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    if (cur instanceof Error) {
      const code = (cur as { code?: unknown }).code;
      const msg = cur.message || cur.name;
      parts.push(code != null ? `${msg} (${String(code)})` : msg);
      cur = (cur as { cause?: unknown }).cause;
    } else if (typeof cur === 'object') {
      const obj = cur as { message?: unknown; type?: unknown };
      if (typeof obj.message === 'string' && obj.message) parts.push(obj.message);
      else if (typeof obj.type === 'string') parts.push(`'${obj.type}' event (no detail)`);
      else parts.push('unknown error object');
      break;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.length ? parts.join(' ← ') : 'unknown error';
}
