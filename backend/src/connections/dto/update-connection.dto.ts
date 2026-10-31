import { IsEnum } from 'class-validator';
import { ConnectionStatus } from '../../generated/prisma/client';

export class UpdateConnectionDto {
  @IsEnum(ConnectionStatus)
  status: ConnectionStatus;
}
