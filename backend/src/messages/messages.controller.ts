import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { EditMessageDto, MarkReadDto } from './dto/edit-message.dto';
import { ListMessagesDto, SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from './messages.service';

@Controller('conversations/:conversationId/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() dto: ListMessagesDto,
  ) {
    return this.messagesService.list(conversationId, user.id, dto);
  }

  @Post()
  @HttpCode(201)
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messagesService.send(conversationId, user.id, dto);
  }

  @Post('read')
  @HttpCode(200)
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: MarkReadDto,
  ) {
    return this.messagesService.markRead(conversationId, user.id, dto);
  }

  @Patch(':id')
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.messagesService.edit(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.messagesService.remove(id, user.id);
  }
}
