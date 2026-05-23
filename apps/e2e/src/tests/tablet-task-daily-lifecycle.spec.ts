import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

/**
 * The child-tablet task experience across a full day boundary for one
 * Restrictable Trackee (Bob): a daily reminder task and a daily recurring
 * (points) task.
 *
 * These specs assert tablet DOM state that is driven by the *browser* clock —
 * reminders auto-complete client-side once `scheduled <= now`, and the
 * THIS WEEK · EARNED graph buckets transactions against the browser's current
 * ISO week. The `clock` fixture pins the browser's `Date` to the fake server
 * clock (see fixtures/clock.ts), so the literal civil times below behave the
 * same in the browser and the schedulers.
 */

const DAY1_0001 = new Date('2026-05-04T00:01:00.000Z');
const DAY1_0900 = new Date('2026-05-04T09:00:00.000Z');
const DAY2_0001 = new Date('2026-05-05T00:01:00.000Z');

test('reminder + recurring: appear not-done, recurring earns +1 (ledger + weekly graph), auto-complete after due, reset next day', async ({
  page,
  api,
  floor,
  factories,
  clock,
}) => {
  // It's just after midnight on day 1 — both tasks are due at 08:00, still ahead.
  await clock.set(DAY1_0001);
  await factories.createTask({
    kind: 'reminder',
    name: 'reminder1',
    due_time: '08:00',
    assignee_ids: [floor.trackeeUserId],
  });
  await factories.createTask({
    kind: 'recurring',
    name: 'recurring1',
    due_time: '08:00',
    points: 1,
    allow_late_completion: true,
    late_window_minutes: 60,
    assignee_ids: [floor.trackeeUserId],
  });

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');

  // Both appear on the routine board, neither completed.
  await expect(tablet.taskRow('reminder1')).toBeVisible();
  await expect(tablet.taskRow('recurring1')).toBeVisible();
  await expect(tablet.taskRow('reminder1')).not.toHaveClass(/is-done/);
  await expect(tablet.taskRow('recurring1')).not.toHaveClass(/is-done/);
  // A reminder is informational — no "Mark done" affordance; a recurring has one.
  await expect(
    tablet.taskRow('reminder1').getByRole('button', { name: /mark done/i }),
  ).toHaveCount(0);
  await expect(
    tablet.taskRow('recurring1').getByRole('button', { name: /mark done/i }),
  ).toBeVisible();

  // Complete the recurring task → +1 point.
  await tablet.markComplete('recurring1');
  await expect(tablet.taskRow('recurring1')).toHaveClass(/is-done/);
  await expect(page.locator('.tb-points-chip')).toContainText(/1\s*PTS/);

  // Ledger: balance is 1 and an earn row was appended.
  const balance = await api.get<{ balance: number }>(
    `/transactions/trackee/${floor.trackeeUserId}/balance`,
    floor.adminToken,
  );
  expect(balance.balance).toBe(1);
  const history = await api.get<{
    transactions: Array<{ amount: number; kind: string }>;
  }>(
    `/transactions/trackee/${floor.trackeeUserId}/history`,
    floor.adminToken,
  );
  expect(
    history.transactions.some((t) => t.kind === 'earn' && t.amount === 1),
  ).toBe(true);

  // THIS WEEK · EARNED graph reflects the +1.
  await tablet.openView('Points');
  await expect(page.locator('.tb-week-foot .v')).toContainText(/\+1\s*PTS/);

  // Advance to 09:00 (past the 08:00 due time): both tasks now show complete —
  // recurring is still marked complete, the reminder auto-completes.
  await clock.set(DAY1_0900);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');
  await expect(tablet.taskRow('reminder1')).toHaveClass(/is-done/);
  await expect(tablet.taskRow('recurring1')).toHaveClass(/is-done/);

  // Roll over to just after midnight on day 2 — fresh occurrences, both reset
  // to not-completed and the recurring is actionable again.
  await clock.set(DAY2_0001);
  await factories.generateOccurrences();
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');
  await expect(tablet.taskRow('reminder1')).toBeVisible();
  await expect(tablet.taskRow('recurring1')).toBeVisible();
  await expect(tablet.taskRow('reminder1')).not.toHaveClass(/is-done/);
  await expect(tablet.taskRow('recurring1')).not.toHaveClass(/is-done/);
  await expect(
    tablet.taskRow('recurring1').getByRole('button', { name: /mark done/i }),
  ).toBeVisible();
});

test('inactive (active=false) reminder and recurring tasks never appear on the tablet', async ({
  page,
  floor,
  factories,
  clock,
}) => {
  await clock.set(DAY1_0001);
  await factories.createTask({
    kind: 'reminder',
    name: 'reminder1',
    due_time: '08:00',
    active: false,
    assignee_ids: [floor.trackeeUserId],
  });
  await factories.createTask({
    kind: 'recurring',
    name: 'recurring1',
    due_time: '08:00',
    points: 1,
    active: false,
    assignee_ids: [floor.trackeeUserId],
  });

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');

  // Inactive tasks generate no occurrences, so the board loads with zero tasks
  // (the "done" ring reads 0/0) and neither task row is ever rendered.
  await expect(page.locator('.tb-ring-num')).toContainText('0/0');
  await expect(tablet.taskRow('reminder1')).toHaveCount(0);
  await expect(tablet.taskRow('recurring1')).toHaveCount(0);
});
