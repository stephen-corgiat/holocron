import type { Page } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/login');
  }

  async signIn(username: string, password: string): Promise<void> {
    await this.page.getByLabel('Username').fill(username);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: /sign in/i }).click();
  }

  async errorText(): Promise<string | null> {
    const err = this.page.locator('.auth-error');
    if (await err.count() === 0) return null;
    return err.first().textContent();
  }
}
