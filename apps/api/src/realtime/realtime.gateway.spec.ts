import { RealtimeGateway } from './realtime.gateway';
import { AuthService } from '../auth/auth.service';
import { Socket } from 'socket.io';
import { SessionJwtPayload } from '../auth/jwt-payload';
import { RealtimeBus } from './realtime-bus';

const stubAuth = {
  verifyToken: jest.fn<Promise<SessionJwtPayload>, [string]>(),
} as unknown as AuthService;

function makeClient(opts: {
  id?: string;
  token?: string;
  header?: string;
}): Socket & { data: { session?: SessionJwtPayload } } {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    id: opts.id ?? 'sock-1',
    data: {},
    handshake: {
      auth: opts.token ? { token: opts.token } : {},
      headers: opts.header ? { authorization: opts.header } : {},
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
    on(event: string, fn: (...args: unknown[]) => void) {
      (handlers[event] ??= []).push(fn);
    },
  } as unknown as Socket & { data: { session?: SessionJwtPayload } };
}

describe('RealtimeGateway', () => {
  let bus: RealtimeBus;

  beforeEach(() => {
    jest.resetAllMocks();
    bus = new RealtimeBus();
  });

  it('disconnects sockets that arrive with no token', async () => {
    const gateway = new RealtimeGateway(stubAuth, bus);
    const client = makeClient({});

    await gateway.handleConnection(client);

    expect(client.emit).toHaveBeenCalledWith(
      'auth_error',
      expect.objectContaining({ reason: 'missing token' }),
    );
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects sockets that arrive with an invalid token', async () => {
    (stubAuth.verifyToken as jest.Mock).mockRejectedValueOnce(new Error('bad'));
    const gateway = new RealtimeGateway(stubAuth, bus);
    const client = makeClient({ token: 'nope' });

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('attaches the verified session and answers ping', async () => {
    const session: SessionJwtPayload = {
      sub: 'tablet:abc',
      kind: 'tablet',
      is_admin: false,
      enrolled_by: 'admin-uuid',
    };
    (stubAuth.verifyToken as jest.Mock).mockResolvedValueOnce(session);
    const gateway = new RealtimeGateway(stubAuth, bus);
    const client = makeClient({ id: 'sock-9', token: 'tok' });

    await gateway.handleConnection(client);
    const result = gateway.ping(client, { sent_at: 42 });

    expect(client.data.session).toEqual(session);
    expect(result).toMatchObject({
      sent_at: 42,
      client_id: 'sock-9',
      session_kind: 'tablet',
    });
  });

  it('broadcasts users:roster_changed when the bus fires', () => {
    const gateway = new RealtimeGateway(stubAuth, bus);
    const emit = jest.fn();
    gateway.server = { emit } as unknown as RealtimeGateway['server'];

    gateway.afterInit();
    bus.emit({ kind: 'users:roster_changed' });

    expect(emit).toHaveBeenCalledWith(
      'users:roster_changed',
      expect.objectContaining({ at: expect.any(String) }),
    );
  });

  it('broadcasts tasks:changed when the bus fires', () => {
    const gateway = new RealtimeGateway(stubAuth, bus);
    const emit = jest.fn();
    gateway.server = { emit } as unknown as RealtimeGateway['server'];

    gateway.afterInit();
    bus.emit({ kind: 'tasks:changed' });

    expect(emit).toHaveBeenCalledWith(
      'tasks:changed',
      expect.objectContaining({ at: expect.any(String) }),
    );
  });

  it('broadcasts transactions:changed with the user_id payload', () => {
    const gateway = new RealtimeGateway(stubAuth, bus);
    const emit = jest.fn();
    gateway.server = { emit } as unknown as RealtimeGateway['server'];

    gateway.afterInit();
    bus.emit({ kind: 'transactions:changed', userId: 'u-bob' });

    expect(emit).toHaveBeenCalledWith(
      'transactions:changed',
      expect.objectContaining({ at: expect.any(String), user_id: 'u-bob' }),
    );
  });

  it('broadcasts goals:completed with the full payload', () => {
    const gateway = new RealtimeGateway(stubAuth, bus);
    const emit = jest.fn();
    gateway.server = { emit } as unknown as RealtimeGateway['server'];
    gateway.afterInit();
    bus.emit({
      kind: 'goals:completed',
      userId: 'u-bob',
      goalId: 'g-1',
      goalName: 'Read',
      amount: 5,
      celebrationVariantId: 'fireworks',
    });
    expect(emit).toHaveBeenCalledWith(
      'goals:completed',
      expect.objectContaining({
        user_id: 'u-bob',
        goal_id: 'g-1',
        goal_name: 'Read',
        amount: 5,
        celebration_variant_id: 'fireworks',
      }),
    );
  });

  it('broadcasts audible_warning:fire using the event timestamp', () => {
    const gateway = new RealtimeGateway(stubAuth, bus);
    const emit = jest.fn();
    gateway.server = { emit } as unknown as RealtimeGateway['server'];
    gateway.afterInit();
    bus.emit({
      kind: 'audible_warning:fire',
      at: new Date('2026-05-15T18:00:00Z'),
    });
    expect(emit).toHaveBeenCalledWith('audible_warning:fire', {
      at: '2026-05-15T18:00:00.000Z',
    });
  });
});
