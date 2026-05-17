import { AdminShell } from '../admin/AdminShell';
import { AdminHouseholdSettingsPage } from './AdminHouseholdSettingsPage';
import { AdminEnrollTabletPage } from './AdminEnrollTabletPage';

export function AdminSettingsPage() {
  return (
    <AdminShell
      active="settings"
      title="Settings"
      subtitle="Household-level configuration · device enrollment"
    >
      <AdminHouseholdSettingsPage />
      <AdminEnrollTabletPage />
    </AdminShell>
  );
}
