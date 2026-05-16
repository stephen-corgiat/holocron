import {
  IsBoolean,
  IsHexColor,
  IsIP,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const ROUTER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateTrackeeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  display_name!: string;

  @IsBoolean()
  is_admin!: boolean;

  @IsBoolean()
  is_restrictable!: boolean;

  /** Empty string is allowed and means "skip router enforcement for this Trackee." */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(ROUTER_ID_PATTERN, {
    message: 'router_id must be lowercase alphanumeric segments separated by single hyphens',
  })
  router_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  avatar?: string | null;

  @IsOptional()
  @IsString()
  @IsHexColor()
  color?: string | null;

  /** Required only when is_admin = true (admins log into the browser). */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password?: string;

  /** Username — required only for admins. Auto-derived from display_name slug if omitted. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username?: string;
}

export class UpdateTrackeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  display_name?: string;

  @IsOptional()
  @IsBoolean()
  is_admin?: boolean;

  @IsOptional()
  @IsBoolean()
  is_restrictable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(ROUTER_ID_PATTERN, {
    message: 'router_id must be lowercase alphanumeric segments separated by single hyphens',
  })
  router_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  avatar?: string | null;

  @IsOptional()
  @IsString()
  @IsHexColor()
  color?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password?: string;

  /** Username — admins log into the browser with it. Normalized server-side. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username?: string;
}

const MAC_PATTERN = /^[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}$/;

/**
 * Each Device requires at least one of `ip_address` or
 * `mac_address`. `display_name` is mandatory. Empty strings are coerced to
 * absent by the service so the CHECK constraint reflects intent.
 */
export class DeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  display_name!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsIP()
  ip_address?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @Matches(MAC_PATTERN, {
    message: 'mac_address must be six colon-separated hex octets',
  })
  mac_address?: string | null;
}
