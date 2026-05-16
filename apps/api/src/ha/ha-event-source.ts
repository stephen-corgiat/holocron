import { Inject, Injectable, Logger } from '@nestjs/common';
import { HA_CONFIG, HaConfig } from './ha-config';
import { describeHaError } from './ha-errors';
import { HaEntityState } from './ha-http-client';
import { HaStatus } from './ha-snapshot';

/** A single whitelisted-entity change off HA's `state_changed` stream. */
export interface HaStateChange {
  entityId: string;
  /** The new state, or `null` when the entity was removed. */
  newState: HaEntityState | null;
}

/**
 * Port over HA's long-lived event WS so the events service can be driven by a
 * controllable fake in e2e (never the real instance). The real adapter holds
 * the persistent `state_changed` subscription; status transitions drive the
 * header link pill.
 */
export interface HaEventSource {
  start(): void;
  stop(): void;
  onChange(cb: (change: HaStateChange) => void): void;
  onStatus(cb: (status: HaStatus) => void): void;
}

export const HA_EVENT_SOURCE = Symbol('HA_EVENT_SOURCE');

/**
 * Real adapter: a long-lived WebSocket to HA (`/api/websocket`) that
 * authenticates, subscribes to `state_changed`, and reshapes each event to a
 * small {@link HaStateChange}. Reconnects with capped backoff. Only ever runs
 * against the live instance — e2e uses {@link FakeHaEventSource} instead, so
 * this transport carries no automated test weight (its filtering/shaping is
 * covered downstream in HaEventsService + on-list-filter).
 */
@Injectable()
export class WsHaEventSource implements HaEventSource {
  private readonly logger = new Logger('WsHaEventSource');
  private ws: WebSocket | null = null;
  private msgId = 1;
  private backoffMs = 1_000;
  private readonly maxBackoffMs = 30_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private changeCb: (change: HaStateChange) => void = () => {};
  private statusCb: (status: HaStatus) => void = () => {};

  constructor(@Inject(HA_CONFIG) private readonly config: HaConfig) {}

  onChange(cb: (change: HaStateChange) => void): void {
    this.changeCb = cb;
  }

  onStatus(cb: (status: HaStatus) => void): void {
    this.statusCb = cb;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  private wsUrl(): string {
    return `${this.config.baseUrl.replace(/^http/, 'ws')}/api/websocket`;
  }

  private connect(): void {
    if (this.stopped) return;
    this.statusCb('stale');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl());
    } catch (err) {
      this.logger.warn(`HA WS connect threw: ${describeHaError(err)}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onmessage = (ev: MessageEvent) => this.handleMessage(ev);
    ws.onerror = (ev) => {
      this.logger.warn(`HA WS error: ${describeHaError(ev)}`);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.statusCb('disconnected');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(payload: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(payload));
  }

  private handleMessage(ev: MessageEvent): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'auth_required':
        this.send({ type: 'auth', access_token: this.config.token });
        break;
      case 'auth_ok':
        this.send({
          id: this.msgId++,
          type: 'subscribe_events',
          event_type: 'state_changed',
        });
        // Subscription is in flight; treat the link as healthy. The events
        // service seeds the store via REST on this transition.
        this.backoffMs = 1_000;
        this.statusCb('ok');
        break;
      case 'auth_invalid':
        this.logger.error('HA WS auth rejected — check HA_TOKEN');
        this.statusCb('disconnected');
        this.stop();
        break;
      case 'event': {
        const change = parseStateChanged(msg);
        if (change) this.changeCb(change);
        break;
      }
      default:
        break;
    }
  }
}

function parseStateChanged(msg: Record<string, unknown>): HaStateChange | null {
  const event = (msg.event ?? {}) as Record<string, unknown>;
  if (event.event_type !== 'state_changed') return null;
  const data = (event.data ?? {}) as Record<string, unknown>;
  const entityId = data.entity_id;
  if (typeof entityId !== 'string') return null;
  const newState = (data.new_state ?? null) as HaEntityState | null;
  return { entityId, newState };
}
