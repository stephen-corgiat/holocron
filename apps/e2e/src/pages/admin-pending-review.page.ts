import { expect, type Locator, type Page } from '@playwright/test';

export class AdminPendingReviewPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/admin/pending');
  }

  row(taskName: string): Locator {
    return this.page
      .locator('.trackee-row', { hasText: taskName })
      .first();
  }

  async approve(taskName: string): Promise<void> {
    await this.row(taskName).getByRole('button', { name: /approve$/i }).click();
  }

  async reject(taskName: string): Promise<void> {
    await this.row(taskName).getByRole('button', { name: /reject/i }).click();
  }

  async expectRow(taskName: string): Promise<void> {
    await expect(this.row(taskName)).toBeVisible();
  }

  async expectNoRow(taskName: string): Promise<void> {
    await expect(this.row(taskName)).toHaveCount(0);
  }
}
