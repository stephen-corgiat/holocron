import { ConfigService } from '@nestjs/config';
import { PiHoleEnforcementConfig } from './pihole-enforcement';

/**
 * Mirrors the factory in restrictions.module.ts. A missing base URL or
 * password must fail at construction so the app refuses to boot rather than
 * silently no-op'ing every PiHole-backed restriction.
 */
function configFactory(config: ConfigService): PiHoleEnforcementConfig {
  const baseUrl = config.get<string>('PIHOLE_BASE_URL') ?? '';
  const apiPassword = config.get<string>('PIHOLE_API_PASSWORD') ?? '';
  if (!baseUrl) throw new Error('PIHOLE_BASE_URL must be set');
  if (!apiPassword) throw new Error('PIHOLE_API_PASSWORD must be set');
  return {
    baseUrl,
    apiPassword,
    groupNamesByScope: {
      games:
        config.get<string>('PIHOLE_GAMES_GROUP_NAME') ??
        'blocked-games-dynamic',
      entertainment:
        config.get<string>('PIHOLE_STREAMING_GROUP_NAME') ??
        'blocked-streaming-dynamic',
    },
  };
}

function stubConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

describe('pihole enforcement config provider', () => {
  it('throws at construction when PIHOLE_BASE_URL is missing', () => {
    expect(() =>
      configFactory(stubConfig({ PIHOLE_API_PASSWORD: 'pw' })),
    ).toThrow(/PIHOLE_BASE_URL/);
  });

  it('throws at construction when PIHOLE_API_PASSWORD is missing', () => {
    expect(() =>
      configFactory(stubConfig({ PIHOLE_BASE_URL: 'http://pi.hole' })),
    ).toThrow(/PIHOLE_API_PASSWORD/);
  });

  it('returns config with default group names when env vars are present', () => {
    const cfg = configFactory(
      stubConfig({
        PIHOLE_BASE_URL: 'http://pi.hole',
        PIHOLE_API_PASSWORD: 'pw',
      }),
    );
    expect(cfg).toEqual({
      baseUrl: 'http://pi.hole',
      apiPassword: 'pw',
      groupNamesByScope: {
        games: 'blocked-games-dynamic',
        entertainment: 'blocked-streaming-dynamic',
      },
    });
  });

  it('honours overridden group names', () => {
    const cfg = configFactory(
      stubConfig({
        PIHOLE_BASE_URL: 'http://pi.hole',
        PIHOLE_API_PASSWORD: 'pw',
        PIHOLE_GAMES_GROUP_NAME: 'custom-games',
        PIHOLE_STREAMING_GROUP_NAME: 'custom-streaming',
      }),
    );
    expect(cfg.groupNamesByScope).toEqual({
      games: 'custom-games',
      entertainment: 'custom-streaming',
    });
  });
});
