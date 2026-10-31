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
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ConversationsService } from './conversations.service';
import {
  AddMembersDto,
  CreateGroupDto,
  MuteConversationDto,
  StartDirectDto,
  UpdateGroupDto,
} from './dto/create-conversation.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.conversationsService.list(user.id);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversationsService.getById(user.id, id);
  }

  @Post('direct')
  startDirect(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartDirectDto,
  ) {
    return this.conversationsService.startDirect(user.id, dto);
  }

  @Post('group')
  @HttpCode(201)
  createGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGroupDto,
  ) {
    return this.conversationsService.createGroup(user.id, dto);
  }

  @Patch(':id')
  updateGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.conversationsService.updateGroup(user.id, id, dto);
  }

  @Post(':id/members')
  @HttpCode(200)
  addMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.conversationsService.addMembers(user.id, id, dto);
  }

  @Delete(':id/members/:userId')
  @HttpCode(200)
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
  ) {
    return this.conversationsService.removeMember(user.id, id, memberId);
  }

  @Patch(':id/mute')
  setMuted(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MuteConversationDto,
  ) {
    return this.conversationsService.setMuted(user.id, id, dto);
  }
}
