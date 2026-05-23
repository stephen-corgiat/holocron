import { expect, type Locator, type Page } from '@playwright/test';

export class AdminCashOutQueuePage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/admin/cashout');
  }

  row(trackeeName: string): Locator {
    return this.page
      .locator('.trackee-row', { hasText: trackeeName })
      .first();
  }

  async commit(trackeeName: string): Promise<void> {
    await this.row(trackeeName).getByRole('button', { name: /commit/i }).click();
  }

  async expectRow(trackeeName: string): Promise<void> {
    await expect(this.row(trackeeName)).toBeVisible();
  }

  async expectEmpty(): Promise<void> {
    await expect(this.page.getByText(/no pending requests/i)).toBeVisible();
  }
}
