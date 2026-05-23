import { expect, type Locator, type Page } from '@playwright/test';

export class TabletPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async waitReady(): Promise<void> {
    await expect(this.page.locator('.tb-tabbar')).toBeVisible();
  }

  async selectTrackee(displayName: string): Promise<void> {
    await this.page.getByRole('tab', { name: new RegExp(displayName, 'i') }).click();
  }

  async openView(view: 'Routine' | 'Pick a goal' | 'Points'): Promise<void> {
    await this.page.getByRole('button', { name: view, exact: true }).click();
  }

  async openFavoritesView(): Promise<void> {
    await this.page.getByRole('button', { name: /open favorites/i }).click();
  }

  async backToAllGoals(): Promise<void> {
    await this.page.getByRole('button', { name: /back to all goals/i }).click();
  }

  async searchGoals(text: string): Promise<void> {
    const input = this.page.getByLabel(/search goals/i);
    await input.fill(text);
  }

  async toggleFavorite(goalName: string): Promise<void> {
    await this.goalCard(goalName)
      .getByRole('button', { name: /favorites/i })
      .click();
  }

  async markInProgress(goalName: string): Promise<void> {
    await this.goalCard(goalName)
      .getByRole('button', { name: /work on this/i })
      .click();
  }

  inProgressCard(goalName: string): Locator {
    return this.page
      .locator('.tb-inprog-card', { hasText: goalName })
      .first();
  }

  recentlyCompletedRow(goalName: string): Locator {
    return this.page
      .locator('.tb-recent-row', { hasText: goalName })
      .first();
  }

  async completeInProgressGoal(goalName: string): Promise<void> {
    await this.inProgressCard(goalName)
      .getByRole('button', { name: /^complete$/i })
      .click();
  }

  async clearInProgressGoal(goalName: string): Promise<void> {
    await this.inProgressCard(goalName)
      .getByRole('button', { name: /clear without completing/i })
      .click();
  }

  async pickRecentlyCompletedAgain(goalName: string): Promise<void> {
    await this.recentlyCompletedRow(goalName)
      .getByRole('button', { name: /work on this again/i })
      .click();
  }

  taskRow(taskName: string): Locator {
    return this.page
      .locator('.tb-task-row', { hasText: taskName })
      .first();
  }

  async markComplete(taskName: string): Promise<void> {
    await this.taskRow(taskName)
      .getByRole('button', { name: /mark done/i })
      .click();
  }

  async lateComplete(taskName: string): Promise<void> {
    await this.taskRow(taskName)
      .getByRole('button', { name: /^late/i })
      .click();
  }

  async balanceText(): Promise<string> {
    const chip = this.page.locator('.tb-points-chip').first();
    await expect(chip).toBeVisible();
    return (await chip.textContent()) ?? '';
  }

  async hasLockBadge(displayName: string): Promise<boolean> {
    const tab = this.page.getByRole('tab', { name: new RegExp(displayName, 'i') });
    return (await tab.locator('.tb-tab-lock').count()) > 0;
  }

  async waitForLockBadge(displayName: string): Promise<void> {
    const tab = this.page.getByRole('tab', { name: new RegExp(displayName, 'i') });
    await expect(tab.locator('.tb-tab-lock')).toBeVisible();
  }

  async waitForNoLockBadge(displayName: string): Promise<void> {
    const tab = this.page.getByRole('tab', { name: new RegExp(displayName, 'i') });
    await expect(tab.locator('.tb-tab-lock')).toHaveCount(0);
  }

  goalCard(goalName: string): Locator {
    return this.page.locator('.tb-goal-card', { hasText: goalName }).first();
  }

  async completeFlatGoal(goalName: string): Promise<void> {
    await this.goalCard(goalName)
      .getByRole('button', { name: /i did this/i })
      .click();
  }

  /**
   * Tiered cards have an inline "I did this" button that opens the
   * TierPickerDialog directly (without requiring an in-progress hop).
   */
  async pickGoalTier(goalName: string, points: number): Promise<void> {
    await this.goalCard(goalName)
      .getByRole('button', { name: /i did this/i })
      .click();
    await this.page
      .locator('.tb-tier-card', { hasText: `+${points}` })
      .first()
      .click();
    await this.page
      .getByRole('button', { name: new RegExp(`Confirm \\+?${points}`, 'i') })
      .click();
  }

  async openCashOutDialog(): Promise<void> {
    await this.page.getByRole('button', { name: /request cash-out/i }).click();
  }

  async submitCashOut(amount: number): Promise<void> {
    const input = this.page.getByLabel(/cash-out amount/i);
    await input.fill(String(amount));
    await this.page.getByRole('button', { name: /send request/i }).click();
  }

  async expectCashOutDisabled(): Promise<void> {
    const btn = this.page.getByRole('button', {
      name: /cash out · unavailable/i,
    });
    await expect(btn).toBeDisabled();
  }
}
