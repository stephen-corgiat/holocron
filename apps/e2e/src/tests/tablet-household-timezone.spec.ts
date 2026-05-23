import { test, expect } from '../fixtures';
import { TabletPage } from '../pages/tablet.page';
import { injectTabletToken } from '../fixtures/auth';

/**
 * End-to-end guard for ADR-0007: the wall tablet renders task times in the
 * configured household time zone, NOT the API process zone (which the e2e
 * harness pins to UTC) nor the browser zone.
 *
 * We set the household zone to America/New_York, create a task due at 15:00,
 * and assert the tablet shows "15:00". If times were derived from the UTC
 * instant in the process/browser zone (the pre-ADR-0007 bug), the cell would
 * read 19:00/20:00 instead.
 */
test('tablet renders task times in the configured household time zone', async ({
  page,
  api,
  floor,
  factories,
  clock,
}) => {
  // Configure the household zone to a non-UTC zone (EDT in May = UTC-4).
  await api.patch(
    '/admin/settings/household',
    { time_zone: 'America/New_York' },
    floor.adminToken,
  );

  // Mid-morning UTC on a fixed day; 15:00 NY (19:00 UTC) is still in the future
  // so the task renders as actionable, not missed.
  await clock.set(new Date('2026-05-04T12:00:00.000Z'));

  await factories.createTask({
    name: 'Afternoon chore',
    due_time: '15:00',
    points: 5,
    assignee_ids: [floor.trackeeUserId],
  });
  await factories.generateOccurrences();

  await injectTabletToken(page, floor);
  const tablet = new TabletPage(page);
  await tablet.goto();
  await tablet.waitReady();
  await tablet.selectTrackee('Bob');

  const row = tablet.taskRow('Afternoon chore');
  await expect(row).toBeVisible();
  // The due cell shows the household-local wall clock — 3:00 PM, not the
  // UTC-projected 7:00 PM.
  await expect(row.locator('.tb-task-due')).toHaveText('3:00 PM');

  // Cross-check the API view carries the same household-tz display string and
  // buckets by the household hour (3:00 PM → after_school).
  const occ = await api.get<{
    occurrences: Array<{
      task_name: string;
      display_time: string;
      bucket: string;
    }>;
  }>(`/occurrences/trackee/${floor.trackeeUserId}`, floor.adminToken);
  const mine = occ.occurrences.find((o) => o.task_name === 'Afternoon chore');
  expect(mine?.display_time).toBe('3:00 PM');
  expect(mine?.bucket).toBe('after_school');
});
