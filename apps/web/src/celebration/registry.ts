import { ReactNode } from 'react';

/**
 * Goal Celebration variant registry.
 *
 * A variant is a self-contained celebration overlay. Each variant registers
 * an id (matching `goals.celebration_variant_id` when pinned), a display
 * name, and a `render()` function that returns the overlay element. Variants
 * are picked at random when a Goal has no pinned id.
 *
 * New variants register here the same way.
 */

export interface CelebrationContext {
  goalId: string;
  goalName: string;
  amount: number;
  /**
   * Display name of the Trackee who completed the goal. Used by variants
   * that personalize the headline (e.g. "Well done, Alice.").
   */
  trackeeName: string;
  /** Trackee's balance immediately after the earn lands. */
  newBalance: number;
  /** Household-settings cash-out rate (USD per point). */
  dollarRate: number;
  /** Called once the overlay's intrinsic animation is done. */
  onDone: () => void;
  /**
   * Optional secondary action — when present, the variant may surface a
   * "Pick another goal" button that runs this callback. The default variant
   * uses this to route the tablet back to the Goals catalog.
   */
  onPickAnother?: () => void;
}

export interface CelebrationVariant {
  id: string;
  name: string;
  render: (ctx: CelebrationContext) => ReactNode;
}

const variants: CelebrationVariant[] = [];

export function registerVariant(variant: CelebrationVariant): void {
  if (variants.some((v) => v.id === variant.id)) return;
  variants.push(variant);
}

export function listVariants(): CelebrationVariant[] {
  return [...variants];
}

export function pickById(id: string | null): CelebrationVariant | null {
  if (!id) return null;
  return variants.find((v) => v.id === id) ?? null;
}

export function pickRandom(): CelebrationVariant | null {
  if (variants.length === 0) return null;
  const idx = Math.floor(Math.random() * variants.length);
  return variants[idx];
}

/**
 * Pinned id → variant if registered. Otherwise pick at random across all
 * registered variants. Returns null only when the registry is empty.
 */
export function pickVariant(pinnedId: string | null): CelebrationVariant | null {
  return pickById(pinnedId) ?? pickRandom();
}
