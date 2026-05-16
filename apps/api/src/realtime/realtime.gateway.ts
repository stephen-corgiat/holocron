import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SessionJwtPayload } from '../auth/jwt-payload';
import { RealtimeBus, RealtimeEvent } from './realtime-bus';

interface AuthedSocket extends Socket {
  data: { session?: SessionJwtPayload };
}

@WebSocketGateway({
  cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173', credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayInit {
  private readonly logger = new Logger('RealtimeGateway');
  private subscription?: Subscription;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly auth: AuthService,
    private readonly bus: RealtimeBus,
  ) {}

  afterInit(): void {
    this.subscription = this.bus.asObservable().subscribe((event) => {
      this.server.emit(event.kind, toWirePayload(event));
    });
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    const token = extractToken(client);
    if (!token) {
      this.logger.warn(`socket ${client.id} disconnected: missing token`);
      client.emit('auth_error', { reason: 'missing token' });
      client.disconnect(true);
      return;
    }
    try {
      client.data.session = await this.auth.verifyToken(token);
    } catch {
      this.logger.warn(`socket ${client.id} disconnected: invalid token`);
      client.emit('auth_error', { reason: 'invalid or expired token' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('ping')
  ping(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload?: { sent_at?: number },
  ) {
    return {
      sent_at: payload?.sent_at ?? null,
      server_ts: Date.now(),
      client_id: client.id,
      session_kind: client.data.session?.kind ?? null,
    };
  }
}

/**
 * Map an in-process event to its over-the-wire envelope. Centralised so the
 * wire format (event name + JSON shape) lives in one place. Adds `at` for
 * the tablet's stale-fan-out discard.
 */
function toWirePayload(event: RealtimeEvent): Record<string, unknown> {
  const at = new Date().toISOString();
  switch (event.kind) {
    case 'users:roster_changed':
    case 'tasks:changed':
    case 'goals:changed':
      return { at };
    case 'transactions:changed':
    case 'restrictions:changed':
    case 'goals:user-changed':
      return { at, user_id: event.userId };
    case 'goals:completed':
      return {
        at,
        user_id: event.userId,
        goal_id: event.goalId,
        goal_name: event.goalName,
        amount: event.amount,
        celebration_variant_id: event.celebrationVariantId,
      };
    case 'audible_warning:fire':
      return { at: event.at.toISOString() };
    case 'ha:state_changed':
      // Carry the shaped delta itself (not a re-fetch nudge) so the tablet
      // applies it without a follow-up HTTP round-trip.
      return { at, ...event.delta };
  }
}

function extractToken(client: Socket): string | null {
  const auth = (client.handshake.auth ?? {}) as { token?: unknown };
  if (typeof auth.token === 'string' && auth.token.length > 0) return auth.token;
  const header = client.handshake.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return null;
}
