import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * The private number a user shares. Accepts the number with any separators
 * (spaces, dashes) — it is normalised to digits before lookup.
 */
export class SendConnectionDto {
  @IsString()
  @MaxLength(32)
  @Matches(/^[\d\s+-]+$/, {
    message: 'connectNumber must contain digits, spaces, dashes or a + prefix',
  })
  connectNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  message?: string;
}
