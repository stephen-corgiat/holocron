import { expect, type Locator, type Page } from '@playwright/test';

type Scope = 'internet' | 'entertainment' | 'games';

const SCOPE_LABEL: Record<Scope, RegExp> = {
  internet: /internet/i,
  entertainment: /entertainment/i,
  games: /games/i,
};

export class AdminRestrictionsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/admin/restrictions');
  }

  scopeCard(scope: Scope): Locator {
    return this.page
      .locator('.restrictions-scope-card', { hasText: SCOPE_LABEL[scope] })
      .first();
  }

  async clickBlockNow(scope: Scope): Promise<void> {
    await this.scopeCard(scope).getByRole('button', { name: /block now/i }).click();
  }

  async submitBlockModal(
    trackeeName: string,
    reason: string,
  ): Promise<void> {
    const modal = this.page.locator('.modal-panel');
    await expect(modal).toBeVisible();
    await modal.locator('select').selectOption({ label: trackeeName });
    if (reason) await modal.locator('input').first().fill(reason);
    await modal.getByRole('button', { name: /^block now$/i }).click();
  }

  activeRow(trackeeName: string, scope: Scope): Locator {
    return this.page.locator('.restrictions-active-row', {
      hasText: new RegExp(`${trackeeName}.*${SCOPE_LABEL[scope].source}`, 'i'),
    });
  }

  async liftEarly(trackeeName: string, scope: Scope): Promise<void> {
    await this.activeRow(trackeeName, scope)
      .getByRole('button', { name: /lift early/i })
      .click();
  }
}
