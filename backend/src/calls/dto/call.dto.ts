import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CallKind } from '../../generated/prisma/client';

export class StartCallDto {
  @IsUUID('4')
  conversationId: string;

  @IsEnum(CallKind)
  kind: CallKind = CallKind.AUDIO;
}

export class CallIdParamDto {
  @IsUUID('4')
  id: string;
}

export class CallActionDto {
  @IsUUID('4')
  callId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string;
}

/**
 * Query for the call history list.
 *
 * `conversationId` lives here rather than being read as its own `@Query()`
 * parameter: the global `ValidationPipe` runs with `forbidNonWhitelisted`, so
 * mixing a named parameter with a DTO parameter makes it validate the entire
 * query object against this class and reject `conversationId` as unknown.
 */
export class ListCallsDto {
  @IsUUID('4')
  conversationId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}
