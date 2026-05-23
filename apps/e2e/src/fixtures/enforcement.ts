import type { ApiClient } from './api-client';

export interface RouterCall {
  method: 'GET' | 'POST';
  url: string;
  at: string;
}

export interface PiHoleCall {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  body: string | null;
  at: string;
}

export function enforcementFixture(api: ApiClient) {
  return {
    async routerLog(): Promise<RouterCall[]> {
      const res = await api.get<{ calls: RouterCall[] }>('/_e2e/router/log');
      return res.calls;
    },
    async piholeLog(): Promise<PiHoleCall[]> {
      const res = await api.get<{ calls: PiHoleCall[] }>('/_e2e/pihole/log');
      return res.calls;
    },
    async resetLogs(): Promise<void> {
      await api.post('/_e2e/router/reset');
      await api.post('/_e2e/pihole/reset');
    },
  };
}

export type EnforcementFixture = ReturnType<typeof enforcementFixture>;
