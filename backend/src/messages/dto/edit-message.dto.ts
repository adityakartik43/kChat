import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class EditMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;
}

export class MarkReadDto {
  /** Optional explicit list; when omitted every message is marked read. */
  @IsOptional()
  @IsString({ each: true })
  messageIds?: string[];
}
