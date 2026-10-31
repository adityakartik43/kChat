import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CallsModule } from '../calls/calls.module';
import { ConnectionsModule } from '../connections/connections.module';
import { MessagesModule } from '../messages/messages.module';
import { UsersModule } from '../users/users.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ChatGateway } from './gateways/chat.gateway';

@Module({
  imports: [
    CallsModule,
    ConnectionsModule,
    MessagesModule,
    UsersModule,
    // The gateway verifies access tokens itself and passes the secret
    // explicitly, so no global signing config is needed here.
    JwtModule.register({}),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService, ChatGateway],
  exports: [ConversationsService],
})
export class ConversationsModule {}
