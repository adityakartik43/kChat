import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ConnectionsService } from './connections.service';
import { ListConnectionsDto } from './dto/list-connections.dto';
import { SendConnectionDto } from './dto/send-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';

@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  /** Resolve a private number to a public profile before sending a request. */
  @Get('lookup')
  lookup(
    @CurrentUser() user: AuthenticatedUser,
    @Query('number') number: string,
  ) {
    return this.connectionsService.lookupByNumber(user.id, number ?? '');
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListConnectionsDto,
  ) {
    return this.connectionsService.list(user.id, dto);
  }

  @Post()
  @HttpCode(201)
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendConnectionDto) {
    return this.connectionsService.sendRequest(user.id, dto);
  }

  @Patch(':id')
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConnectionDto,
  ) {
    return this.connectionsService.respond(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.connectionsService.remove(id, user.id);
  }
}
