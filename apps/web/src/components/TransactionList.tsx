import { TransactionView } from '../auth/api';
import { Glyph, GlyphName, isKnownGlyph } from '../tablet/icons/Glyph';
import { useHouseholdTimeZone } from '../settings/SettingsProvider';

/**
 * Shared transaction-row renderer used by both the tablet's Points/Ledger
 * view and the admin Ledger page. The component lives outside `tablet/` so it
 * doesn't drag the tablet palette into the admin shell — colours come from
 * CSS variables defined in [tablet.css](apps/web/src/tablet/tablet.css), which
 * is imported wherever this list is rendered.
 */
export interface TransactionListProps {
  transactions: TransactionView[];
  /** When provided, used to enrich the row label (e.g. admin who issued an adjustment). */
  userDisplayBy?: Map<string, string>;
  emptyMessage?: string;
}

const KIND_LABEL: Record<TransactionView['kind'], string> = {
  earn: 'EARN',
  withdrawal: 'WITHDRAWAL',
  penalty: 'PENALTY',
  claw_back: 'CLAW-BACK',
  adjustment: 'ADJUSTMENT',
};

const KIND_GLYPH: Record<TransactionView['kind'], GlyphName> = {
  earn: 'coin',
  withdrawal: 'coin',
  penalty: 'alert',
  claw_back: 'minus',
  adjustment: 'wand',
};

export function TransactionList({
  transactions,
  userDisplayBy,
  emptyMessage = 'No transactions yet.',
}: TransactionListProps) {
  const tz = useHouseholdTimeZone();
  if (transactions.length === 0) {
    return <div className="tb-empty">{emptyMessage}</div>;
  }
  return (
    <ul className="tx-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {transactions.map((t) => {
        const positive = t.amount > 0;
        const cls =
          t.kind === 'withdrawal'
            ? 'neutral'
            : positive
              ? 'positive'
              : 'negative';
        const glyph = pickGlyph(t);
        const adminName = t.admin_user_id
          ? userDisplayBy?.get(t.admin_user_id)
          : null;
        const labelParts: string[] = [t.reason ?? defaultReason(t)];
        if (adminName) labelParts.push(`(${adminName})`);
        return (
          <li key={t.id} className="tx-row">
            <div className={`tx-icon-tile k-${t.kind}`}>
              <Glyph name={glyph} size={18} color="currentColor" />
            </div>
            <div>
              <div className="tx-name">{labelParts.join(' ')}</div>
              <div className="tx-meta">
                <span className={`k-${t.kind}`}>{KIND_LABEL[t.kind]}</span>
                <span style={{ opacity: 0.5 }}> · </span>
                <span>
                  {new Date(t.created_at).toLocaleString(undefined, {
                    timeZone: tz,
                    hour12: true,
                  })}
                </span>
              </div>
            </div>
            <div className={`tx-amount ${cls}`}>
              {positive ? '+' : ''}
              {t.amount}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function pickGlyph(t: TransactionView): GlyphName | string {
  // Earn rows tied to a goal often have a goal name in the reason; we don't
  // have the goal's icon here, so we fall back to a coin. The shape of the
  // mapping leaves room for future enrichment via the optional `icon` glyph.
  if (t.kind === 'earn' && t.reason) {
    // Try to fish a glyph name out of the reason "goal: <name>" form. If
    // unknown, the Glyph component falls back to rendering as text — but for
    // the icon-tile slot we want a real glyph, so we coerce to coin.
    const maybe = t.reason.toLowerCase();
    for (const candidate of ['blocks', 'book', 'vacuum', 'walk', 'piano', 'tooth', 'homework', 'breakfast'] as GlyphName[]) {
      if (maybe.includes(candidate)) return candidate;
    }
  }
  return KIND_GLYPH[t.kind];
}

function defaultReason(t: TransactionView): string {
  switch (t.kind) {
    case 'earn':
      return 'Earned points';
    case 'withdrawal':
      return 'Cash-out';
    case 'penalty':
      return 'Penalty';
    case 'claw_back':
      return 'Claw-back';
    case 'adjustment':
      return 'Balance adjustment';
  }
}

export { isKnownGlyph };
