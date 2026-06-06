import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { makeApi, type ApiClient } from '../fixtures/api-client';

const TABLET_STORAGE_KEY = 'holocron.tablet_token';
const ADMIN_STORAGE_KEY = 'holocron.admin_token';

// Wednesday on Alice's "Week 1" presence grid — she is home, has all her
// daily and weekday tasks, and we're a few minutes past Homework's 17:30
// LA due time so it's the last "currently pending" item on screen. The
// household defaults to America/Los_Angeles, so we offset the UTC clock by
// PDT (UTC-7): 00:35 UTC ≡ 17:35 Wed LA.
const CLOCK_ISO = '2026-05-14T00:35:00.000Z';

// Output dir. The build script reads PNGs from here in lexical order.
const SHOTS_DIR = path.resolve(__dirname, '../../../../docs/screenshots/shots');

interface OccurrenceView {
  id: string;
  task_id: string;
  task_name: string;
  // Mirrors apps/api/src/tasks/occurrences.service.ts:OccurrenceView.status.
  status:
    | 'active'
    | 'auto_complete'
    | 'complete'
    | 'pending_review'
    | 'excused'
    | 'missed';
}

interface TrackeeView {
  id: string;
  display_name: string;
  is_admin: boolean;
}

test('marketing hero storyboard', async ({ page, context }) => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const f of fs.readdirSync(SHOTS_DIR)) {
    if (f.endsWith('.png')) fs.unlinkSync(path.join(SHOTS_DIR, f));
  }

  const api = await makeApi();
  try {
    const { adminToken, tabletToken } = await prepareDemoState(api);

    // Both ends must agree on "today" or the tablet asks the backend for
    // the wrong day's occurrences. Playwright's clock pins the browser at
    // the same instant as the server FakeClock; from here on, `new Date()`
    // in the page returns the demo time.
    await page.clock.install({ time: new Date(CLOCK_ISO) });

    // ── Tablet shots ────────────────────────────────────────────────────
    await sealTokens(page, context, { tabletToken });
    await page.goto('/');
    await page.locator('.tb-tabbar').waitFor({ state: 'visible' });
    await page.getByRole('tab', { name: /alice/i }).click();

    // Beat 1 — routine view, Homework as the lone pending task.
    await page.locator('.tb-task-row', { hasText: /homework/i }).first().waitFor();
    await settle(page);
    await shoot(page, '01-routine.png');

    // Mark Homework done so the next beat shows the resulting state with
    // "pending review" pill (the seeded task has requiresVerification=true).
    await page
      .locator('.tb-task-row', { hasText: /homework/i })
      .first()
      .getByRole('button', { name: /mark done/i })
      .click();
    await page.waitForTimeout(800);
    await settle(page);
    await shoot(page, '02-completion.png');

    // Beat 3 — open the tier picker for "Write a short story or poem".
    // Tiered goals now defer the tier pick until completion: mark the goal
    // in-progress on the Goals catalog, switch to Routine, then tap Complete
    // on the in-progress strip to open the dialog. Capture the modal *with*
    // ~150px of surrounding view so it reads as a focused interaction.
    await page.locator('.tb-viewbtn', { hasText: /^pick a goal$/i }).click();
    const storyCard = page
      .locator('.tb-goal-card', { hasText: /write a short story or poem/i })
      .first();
    await storyCard.scrollIntoViewIfNeeded();
    await storyCard.getByRole('button', { name: /work on this/i }).click();
    await page.locator('.tb-viewbtn', { hasText: /^routine$/i }).click();
    const storyInProg = page
      .locator('.tb-inprog-card', { hasText: /write a short story or poem/i })
      .first();
    await storyInProg
      .getByRole('button', { name: /^complete$/i })
      .click();
    const dialog = page.locator('.tb-dialog').first();
    await dialog.waitFor({ state: 'visible' });
    await page.locator('.tb-tier-card').nth(1).click();
    await settle(page);
    await shootWithContext(page, dialog, '03-tier-modal.png', 150);

    // Beat 4 — confirm the tier so the celebration overlay fires. Full
    // viewport capture (the overlay is intentionally full-screen).
    await page.getByRole('button', { name: /^confirm \+/i }).click();
    const celebration = page.locator('.tb-celebration');
    await celebration.waitFor({ state: 'visible' });
    // Confetti animates; hold briefly so the screenshot lands on a settled
    // composition rather than mid-flight bits.
    await page.waitForTimeout(800);
    await shoot(page, '04-celebration.png');

    // Dismiss before navigating away.
    await page
      .locator('.tb-celebration')
      .getByRole('button', { name: /back to routine/i })
      .click();
    await page.waitForTimeout(300);

    // Beat 5 — cash-out request dialog. Alice now has earned points and
    // can (optionally) redeem them for cash. Navigate to the Points view,
    // open the request dialog, capture with surrounding context.
    await page.locator('.tb-viewbtn', { hasText: /^points$/i }).click();
    await page.getByRole('button', { name: /request cash-out/i }).click();
    const cashoutDialog = page.locator('.tb-dialog').first();
    await cashoutDialog.waitFor({ state: 'visible' });
    await settle(page);
    await shootWithContext(page, cashoutDialog, '05-cashout.png', 150);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ── Admin shots ─────────────────────────────────────────────────────
    await sealTokens(page, context, { adminToken });

    await page.goto('/admin/pending');
    await page.waitForLoadState('networkidle');
    await settle(page);
    await shoot(page, '06-admin-pending.png');

    await page.goto('/admin/restrictions');
    await page.waitForLoadState('networkidle');
    await settle(page);
    await shoot(page, '07-admin-restrictions.png');

    await page.goto('/admin/presence');
    await page.waitForLoadState('networkidle');
    await settle(page);
    await shoot(page, '08-admin-presence.png');
  } finally {
    await api.raw.dispose();
  }

  // Sanity assertion so a failing capture surfaces as a red Playwright run.
  const written = fs
    .readdirSync(SHOTS_DIR)
    .filter((f) => f.endsWith('.png'))
    .sort();
  expect(written.length).toBeGreaterThanOrEqual(8);
});

async function settle(page: Page): Promise<void> {
  // Give the UI a beat to finish in-flight transitions / network paints
  // before we snap a still. waitForLoadState('networkidle') doesn't catch
  // CSS transitions or post-fetch react renders, so we add a small explicit
  // pause on top.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
}

async function shoot(page: Page, file: string): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS_DIR, file),
    fullPage: false,
    animations: 'disabled',
  });
}

/**
 * Screenshot an element with `padPx` of surrounding viewport included on
 * every side. Useful for modal close-ups that should still read as
 * happening "inside" the app rather than as a floating standalone card.
 */
async function shootWithContext(
  page: Page,
  target: ReturnType<Page['locator']>,
  file: string,
  padPx: number,
): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error(`element has no bounding box for ${file}`);
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const x = Math.max(0, box.x - padPx);
  const y = Math.max(0, box.y - padPx);
  const right = Math.min(viewport.width, box.x + box.width + padPx);
  const bottom = Math.min(viewport.height, box.y + box.height + padPx);
  await page.screenshot({
    path: path.join(SHOTS_DIR, file),
    clip: { x, y, width: right - x, height: bottom - y },
    animations: 'disabled',
  });
}

interface DemoState {
  adminToken: string;
  tabletToken: string;
}

async function prepareDemoState(api: ApiClient): Promise<DemoState> {
  // Pin the clock + materialize occurrences for the demo day.
  await api.post('/_e2e/clock/set', { iso: CLOCK_ISO });
  await api.post('/_e2e/occurrences/generate');

  // Real admin login (seed creates Chad with password "change-me").
  const login = await api.post<{ token: string; user: TrackeeView }>(
    '/auth/login',
    { username: 'chad', password: 'change-me' },
  );
  const adminToken = login.token;

  const roster = await api.get<{ trackees: TrackeeView[] }>('/users', adminToken);
  const alice = mustFind(roster.trackees, 'Alice');
  const bob = mustFind(roster.trackees, 'Bob');

  // Pre-complete every Alice occurrence except "Homework done" so the
  // tablet routine view opens on a single pending task — the cleanest
  // possible visual for beat 1.
  const occs = await api.get<{ occurrences: OccurrenceView[] }>(
    `/occurrences/trackee/${alice.id}`,
    adminToken,
  );
  for (const occ of occs.occurrences) {
    if (occ.status !== 'active') continue;
    if (/homework/i.test(occ.task_name)) continue;
    await api.post(`/occurrences/${occ.id}/complete`, undefined, adminToken);
  }

  // Beat 5 needs a visible restriction on the admin page. Block Bob's
  // entertainment scope — admin block-now is parent-controlled and clears
  // cleanly when the screenshots DB is recreated next run.
  await api.post(
    '/admin/restrictions/block-now',
    { user_id: bob.id, scope: 'entertainment', reason: 'Demo screenshot' },
    adminToken,
  );

  // Seed Alice with some goal activity so the refactored Routine view shows
  // the "Recently completed" teaser and "Goals in progress" strip on beat 1.
  const aliceCatalog = await api.get<{
    goals: { id: string; name: string; kind: string }[];
  }>(`/goals/catalog?user_id=${alice.id}`, adminToken);
  const visibleFlat = aliceCatalog.goals.filter((g) => g.kind === 'flat');
  // Complete two flat goals so they appear in Recently completed.
  for (const g of visibleFlat.slice(0, 2)) {
    await api.post(
      `/goals/${g.id}/complete`,
      { user_id: alice.id },
      adminToken,
    );
  }
  // Mark one more flat goal as in-progress so the Routine strip is non-empty.
  const inProgressTarget = visibleFlat[2];
  if (inProgressTarget) {
    await api.post(
      `/goals/${inProgressTarget.id}/in-progress?user_id=${alice.id}`,
      undefined,
      adminToken,
    );
  }

  // Mint a tablet token: admin issues a one-time enrollment code, then we
  // redeem it as an unauthenticated tablet would.
  const codeRes = await api.post<{ code: string }>(
    '/auth/tablet/enrollment-code',
    undefined,
    adminToken,
  );
  const enroll = await api.post<{ token: string }>('/auth/tablet/enroll', {
    code: codeRes.code,
  });

  return { adminToken, tabletToken: enroll.token };
}

/**
 * Swap the active session token in browser storage by visiting the origin
 * first (so `localStorage` is available), wiping both keys, then writing
 * the one we want. `addInitScript` is intentionally avoided here — it
 * fires on every navigation and would clobber the admin token when we
 * switch surfaces inside the same page.
 */
async function sealTokens(
  page: Page,
  _context: BrowserContext,
  tokens: { tabletToken?: string; adminToken?: string },
): Promise<void> {
  await page.goto('/login');
  await page.evaluate(
    ({ tabletKey, adminKey, tabletToken, adminToken }) => {
      localStorage.removeItem(tabletKey);
      sessionStorage.removeItem(adminKey);
      if (tabletToken) localStorage.setItem(tabletKey, tabletToken);
      if (adminToken) sessionStorage.setItem(adminKey, adminToken);
    },
    {
      tabletKey: TABLET_STORAGE_KEY,
      adminKey: ADMIN_STORAGE_KEY,
      tabletToken: tokens.tabletToken,
      adminToken: tokens.adminToken,
    },
  );
}

function mustFind(trackees: TrackeeView[], name: string): TrackeeView {
  const match = trackees.find((t) => t.display_name === name);
  if (!match) {
    throw new Error(
      `Expected to find ${name} in roster; got ${trackees.map((t) => t.display_name).join(', ')}`,
    );
  }
  return match;
}
