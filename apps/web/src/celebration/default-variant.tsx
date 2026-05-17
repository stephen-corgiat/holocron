import { CelebrationContext, registerVariant } from './registry';
import { Icon } from '../tablet/icons/Icon';
import { HolocronLogo } from '../tablet/icons/Glyph';
import '../tablet/tablet.css';

/**
 * Default celebration variant — Holocron-themed full-screen overlay. No
 * auto-fade: a Trackee chooses Back to routine or Pick another goal.
 */
function DefaultCelebration({
  goalName,
  amount,
  trackeeName,
  newBalance,
  dollarRate,
  onDone,
  onPickAnother,
}: CelebrationContext) {
  const dollars = (newBalance * dollarRate).toFixed(2);
  return (
    <div className="tb-celebration" role="status" aria-live="polite">
      <Confetti />
      <div className="tb-celebration-card">
        <div className="tb-celebration-logo">
          <HolocronLogo size={140} />
        </div>
        <div className="tb-celebration-eyebrow">░░░░ CACHE UNLOCKED ░░░░</div>
        <div className="tb-celebration-title">
          {trackeeName ? `Well done, ${trackeeName}.` : 'Well done.'}
        </div>
        <div className="tb-celebration-sub">{goalName} — goal complete.</div>
        <div className="tb-celebration-pill">
          <Icon name="coin" size={26} color="var(--tb-primary)" stroke={2.4} />
          <span className="num">+{amount}</span>
          <span className="unit">PTS</span>
        </div>
        <div className="tb-celebration-balance">
          NEW BALANCE · <b>{newBalance} PTS</b> ·{' '}
          <span className="pri">${dollars}</span>
        </div>
        <div className="tb-celebration-actions">
          <button
            type="button"
            className="tb-dialog-btn is-primary"
            onClick={onDone}
          >
            Back to routine
          </button>
          {onPickAnother && (
            <button
              type="button"
              className="tb-dialog-btn"
              onClick={() => {
                onPickAnother();
                onDone();
              }}
            >
              Pick another goal
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Confetti() {
  const cols = ['var(--tb-primary)', 'var(--tb-accent)', 'var(--tb-warn)'];
  const bits = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div className="tb-celebration-confetti">
      {bits.map((i) => {
        const x = (i * 4.17) % 100;
        const y = (i * 13.7) % 100;
        const s = 8 + (i % 4) * 3;
        return (
          <span
            key={i}
            className="tb-celebration-bit"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: s,
              height: s * 0.45,
              background: cols[i % 3],
              transform: `rotate(${(x * 7 + y * 11) % 180}deg)`,
              boxShadow: `0 0 6px ${cols[i % 3]}`,
            }}
          />
        );
      })}
    </div>
  );
}

registerVariant({
  id: 'default',
  name: 'Cache unlocked (Holocron)',
  render: (ctx) => <DefaultCelebration {...ctx} />,
});
