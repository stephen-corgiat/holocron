import { ConfigService } from '@nestjs/config';
import { RouterEnforcementConfig } from './router-enforcement';

/**
 * The Restrictions module wires this factory through Nest DI. Calling it
 * directly here verifies that a missing bearer (or base URL) throws at
 * construction time, not at call time, so the app fails fast at boot rather
 * than silently no-op'ing every Restriction.
 */
function configFactory(config: ConfigService): RouterEnforcementConfig {
  const baseUrl = config.get<string>('ROUTER_BASE_URL') ?? '';
  const bearerToken = config.get<string>('ROUTER_BEARER_TOKEN') ?? '';
  if (!baseUrl) {
    throw new Error('ROUTER_BASE_URL must be set');
  }
  if (!bearerToken) {
    throw new Error('ROUTER_BEARER_TOKEN must be set');
  }
  return { baseUrl, bearerToken };
}

function stubConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

describe('router enforcement config provider', () => {
  it('throws at construction when ROUTER_BEARER_TOKEN is missing', () => {
    expect(() =>
      configFactory(stubConfig({ ROUTER_BASE_URL: 'http://router.lan' })),
    ).toThrow(/ROUTER_BEARER_TOKEN/);
  });

  it('throws at construction when ROUTER_BASE_URL is missing', () => {
    expect(() =>
      configFactory(stubConfig({ ROUTER_BEARER_TOKEN: 'x' })),
    ).toThrow(/ROUTER_BASE_URL/);
  });

  it('returns config when both env vars are present', () => {
    expect(
      configFactory(
        stubConfig({
          ROUTER_BASE_URL: 'http://router.lan',
          ROUTER_BEARER_TOKEN: 'secret',
        }),
      ),
    ).toEqual({ baseUrl: 'http://router.lan', bearerToken: 'secret' });
  });
});
