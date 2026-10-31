import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ConnectionStatus } from '../../generated/prisma/client';

const toOptional = ({ value }: { value: unknown }) =>
  value === 'all' || value === undefined || value === null ? undefined : value;

/** Filters for the connection list endpoint. */
export class ListConnectionsDto {
  @IsOptional()
  @Transform(toOptional)
  @IsEnum(ConnectionStatus)
  status?: ConnectionStatus;

  @IsOptional()
  @IsString()
  scope?: 'incoming' | 'outgoing' | 'all';
}
