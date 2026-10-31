import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CallsModule } from './calls/calls.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AppConfigModule } from './config/config.module';
import { ConnectionsModule } from './connections/connections.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    UsersModule,
    AuthModule,
    CallsModule,
    ConnectionsModule,
    ConversationsModule,
    MessagesModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
