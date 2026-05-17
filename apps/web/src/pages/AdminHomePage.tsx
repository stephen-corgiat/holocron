import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AdminTrackeesPage } from './AdminTrackeesPage';
import { AdminTasksPage } from './AdminTasksPage';
import { AdminPendingReviewPage } from './AdminPendingReviewPage';
import { AdminOccurrenceHistoryPage } from './AdminOccurrenceHistoryPage';
import { AdminSettingsPage } from './AdminSettingsPage';
import { AdminGoalsPage } from './AdminGoalsPage';
import { AdminPresencePage } from './AdminPresencePage';
import { AdminRestrictionsPage } from './AdminRestrictionsPage';
import { AdminCashOutQueuePage } from './AdminCashOutQueuePage';
import { AdminLedgerPage } from './AdminLedgerPage';

export function AdminHomePage() {
  const { session } = useAuth();
  if (session.kind !== 'admin') return null;

  return (
    <Routes>
      <Route index element={<Navigate to="pending" replace />} />
      <Route path="tasks" element={<AdminTasksPage />} />
      <Route path="goals" element={<AdminGoalsPage />} />
      <Route path="pending" element={<AdminPendingReviewPage />} />
      <Route path="cashout" element={<AdminCashOutQueuePage />} />
      <Route path="ledger" element={<AdminLedgerPage />} />
      <Route path="restrictions" element={<AdminRestrictionsPage />} />
      <Route path="presence" element={<AdminPresencePage />} />
      <Route path="users" element={<AdminTrackeesPage />} />
      <Route path="users/:trackeeId/history" element={<AdminOccurrenceHistoryPage />} />
      <Route path="settings" element={<AdminSettingsPage />} />
      <Route path="*" element={<Navigate to="pending" replace />} />
    </Routes>
  );
}
