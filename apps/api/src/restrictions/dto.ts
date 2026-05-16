import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { RestrictionScope } from './restriction-merge';

export const SCOPES: RestrictionScope[] = [
  'internet',
  'entertainment',
  'games',
];

export class BlockNowDto {
  @IsUUID()
  user_id!: string;

  @IsIn(SCOPES)
  scope!: RestrictionScope;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AskParentDto {
  @IsUUID()
  user_id!: string;

  @IsIn(SCOPES)
  scope!: RestrictionScope;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class LiftEarlyDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export interface RestrictionCauseView {
  id: string;
  kind: 'miss' | 'admin';
  occurrence_id: string | null;
  admin_user_id: string | null;
  reason: string | null;
  contributed_expires_at: string | null;
  contributed_remediation_goals: string[] | null;
  parent_only_on_expiry: boolean;
  parent_only_on_remediation: boolean;
  created_at: string;
  /** Joined for the admin UI — `null` if the underlying occurrence is gone. */
  occurrence_task_name?: string | null;
}

export interface RestrictionView {
  id: string;
  user_id: string;
  user_display_name: string;
  scope: RestrictionScope;
  effective_expires_at: string | null;
  effective_remediation_goals: string[];
  created_at: string;
  causes: RestrictionCauseView[];
}

export interface ScopeSummary {
  scope: RestrictionScope;
  blocked_user_ids: string[];
  total_restrictable: number;
}

export interface RemediationRequestView {
  id: string;
  user_id: string;
  user_display_name: string;
  restriction_id: string;
  scope: RestrictionScope;
  note: string | null;
  created_at: string;
}

export interface EnforcementLogView {
  id: string;
  restriction_id: string | null;
  user_id: string;
  backend: 'router' | 'pihole';
  scope: RestrictionScope;
  action: 'add' | 'del';
  /**
   * For backend='router' this is a comma-separated IP list (one batched
   * call covers every IP-bearing Device for the Trackee). For
   * backend='pihole' it's a single MAC. Null only on `result='skipped'`
   * rows recording "no addressable devices".
   */
  target_address: string | null;
  result: 'ok' | 'error' | 'skipped';
  http_status: number | null;
  error: string | null;
  created_at: string;
}

export interface RestrictionsOverviewResponse {
  scopes: ScopeSummary[];
  active: RestrictionView[];
  remediation_requests: RemediationRequestView[];
  enforcement_log: EnforcementLogView[];
}

export interface ActiveRestrictionByScope {
  id: string;
  scope: RestrictionScope;
  effective_expires_at: string | null;
  effective_remediation_goals: string[];
  causes: RestrictionCauseView[];
}

export interface TabletRestrictionView {
  user_id: string;
  active: ActiveRestrictionByScope[];
}

export interface UserHasActiveRestriction {
  user_id: string;
  has_active: boolean;
}
