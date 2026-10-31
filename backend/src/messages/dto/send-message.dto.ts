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
  MinLength,
} from 'class-validator';
import { MessageType } from '../../generated/prisma/client';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;

  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string;

  @IsOptional()
  @IsUUID()
  replyToId?: string;
}

export class ListMessagesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;

  /** Return messages older than this ISO timestamp (keyset pagination). */
  @IsOptional()
  @IsString()
  before?: string;
}
