import { RestrictionScope } from './restriction-merge';

/**
 * Port implemented by every enforcement adapter (router, PiHole, …). The
 * dispatcher selects an implementation per scope and calls activate/deactivate
 * with no awareness of how the backend addresses the Trackee's devices.
 *
 * Fire-and-forget: implementations must catch and log their own failures.
 * The caller's domain state has already committed by the time these are
 * invoked.
 */
export interface RestrictionBackend {
  /** Engage the block for the Trackee on the given scope. */
  activate(
    userId: string,
    scope: RestrictionScope,
    restrictionId: string,
  ): Promise<void>;

  /** Release the block for the Trackee on the given scope. */
  deactivate(
    userId: string,
    scope: RestrictionScope,
    restrictionId: string | null,
  ): Promise<void>;
}

export const RESTRICTION_BACKEND_ROUTER = Symbol('RESTRICTION_BACKEND_ROUTER');
export const RESTRICTION_BACKEND_PIHOLE = Symbol('RESTRICTION_BACKEND_PIHOLE');
