/**
 * Time port. Injected via `@Inject(CLOCK)`; the module binds it to
 * `SystemClock` normally and `FakeClock` when `E2E_TEST_MODE=true`.
 *
 * Only services that read "now for the side effect about to happen" should
 * depend on this. Pure date arithmetic and parsing on user-supplied dates
 * still uses native Date directly.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');
