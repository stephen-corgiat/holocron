import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class RedeemEnrollmentDto {
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  code!: string;
}
