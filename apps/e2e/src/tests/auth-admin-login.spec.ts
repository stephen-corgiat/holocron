import { test, expect } from '../fixtures';
import { LoginPage } from '../pages/login.page';

test('admin can sign in and lands on the admin shell', async ({
  page,
  floor: _floor,
}) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.signIn('alice', 'alice-pw');
  await expect(page).toHaveURL(/\/admin/);
});

test('admin sees an inline error on bad credentials', async ({
  page,
  floor: _floor,
}) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.signIn('alice', 'wrong');
  await expect(page.locator('.auth-error')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
