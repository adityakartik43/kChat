import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CallsService, SerializedCall } from './calls.service';
import { CallActionDto, ListCallsDto, StartCallDto } from './dto/call.dto';

/**
 * HTTP surface for calls.
 *
 * Starting, accepting and ending are also available over the WebSocket
 * gateway, which is what the UI actually uses, because the caller needs an
 * immediate acknowledgement to start negotiating. These endpoints exist so
 * call history is reachable without a socket, and as a fallback path.
 */
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  /** Rings the other participant in a 1:1 conversation. */
  @Post('start')
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartCallDto,
  ): Promise<SerializedCall> {
    // `superseded` is only meaningful to the gateway, which has to announce
    // the displaced call to every device. Over HTTP the caller only wants the
    // call it just created.
    const { call } = await this.callsService.start(
      dto.conversationId,
      user.id,
      dto.kind,
    );

    return call;
  }

  @HttpCode(200)
  @Post('accept')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CallActionDto,
  ): Promise<SerializedCall> {
    return this.callsService.accept(dto.callId, user.id);
  }

  @HttpCode(200)
  @Post('end')
  end(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CallActionDto,
  ): Promise<SerializedCall> {
    return this.callsService.end(dto.callId, user.id, dto.reason);
  }

  /** Call history for a conversation, expiring stale ringing calls first. */
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCallsDto,
  ): Promise<SerializedCall[]> {
    await this.callsService.expireRinging(query.conversationId, user.id);

    return this.callsService.list(query.conversationId, user.id, query.limit);
  }
}
