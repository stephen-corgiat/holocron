import type { Page } from '@playwright/test';

export class TabletEnrollPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/tablet/enroll');
  }

  async enroll(code: string): Promise<void> {
    await this.page.getByLabel(/enrollment code/i).fill(code);
    await this.page.getByRole('button', { name: /enroll this tablet/i }).click();
  }
}
