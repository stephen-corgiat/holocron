import { IsBoolean, IsIn, IsInt, IsString, Matches } from 'class-validator';

const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;

/**
 * Toggle a light/switch off (or back on). The tablet sends only the target
 * entity + desired state; the proxy validates the domain against the
 * whitelist and maps to the right `turn_on`/`turn_off` service.
 */
export class ToggleDto {
  /** A `<domain>.<object_id>` entity id, e.g. `light.kitchen`. */
  @IsString()
  @Matches(ENTITY_ID, {
    message: 'entityId must be a <domain>.<object_id> id',
  })
  entityId!: string;

  @IsBoolean()
  on!: boolean;
}

/**
 * Thermostat nudge: the tablet sends only the entity + direction; the server
 * does the read-modify-write + clamp.
 */
export class ClimateNudgeDto {
  @IsString()
  @Matches(ENTITY_ID, { message: 'entityId must be a <domain>.<object_id> id' })
  entityId!: string;

  @IsIn([1, -1], { message: 'dir must be 1 (up) or -1 (down)' })
  dir!: 1 | -1;
}

/** House fan: pick a segment; the server maps it via the state→service map. */
export class FanDto {
  @IsString()
  @Matches(ENTITY_ID, { message: 'entityId must be a <domain>.<object_id> id' })
  entityId!: string;

  @IsIn(['off', 'low', 'high'])
  state!: 'off' | 'low' | 'high';
}

/** Night Mode (and any input_boolean scene) toggle. */
export class BooleanDto {
  @IsBoolean()
  on!: boolean;
}
