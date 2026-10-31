import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConnectionStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  formatConnectNumber,
  normalizeConnectNumber,
} from '../common/utils/connect-number.util';
import { ListConnectionsDto } from './dto/list-connections.dto';
import { SendConnectionDto } from './dto/send-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';

const connectionInclude = {
  requester: {
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      connectNumber: true,
      lastSeenAt: true,
    },
  },
  addressee: {
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      connectNumber: true,
      lastSeenAt: true,
    },
  },
} satisfies Prisma.ConnectionInclude;

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Resolves a private number to a public profile. Returns a deliberately
   * vague 404 when the number is unknown so the endpoint cannot be used to
   * confirm which private numbers are registered.
   */
  async lookupByNumber(requesterId: string, rawNumber: string) {
    const digits = normalizeConnectNumber(rawNumber);

    if (!digits) {
      throw new BadRequestException('Private number must be exactly 10 digits');
    }

    const user = await this.usersService.findPublicByConnectNumber(digits);

    if (!user) {
      throw new NotFoundException('No user found with that private number');
    }

    const connection = await this.findConnectionBetween(requesterId, user.id);

    return {
      user: {
        ...user,
        connectNumberFormatted: formatConnectNumber(user.connectNumber),
      },
      connectionState: describeState(requesterId, connection),
      isSelf: user.id === requesterId,
    };
  }

  async sendRequest(requesterId: string, dto: SendConnectionDto) {
    const digits = normalizeConnectNumber(dto.connectNumber);

    if (!digits) {
      throw new BadRequestException('Private number must be exactly 10 digits');
    }

    const addressee = await this.usersService.findPublicByConnectNumber(digits);

    if (!addressee) {
      throw new NotFoundException('No user found with that private number');
    }

    if (addressee.id === requesterId) {
      throw new BadRequestException('You cannot connect with yourself');
    }

    const existing = await this.prisma.connection.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId: addressee.id },
          { requesterId: addressee.id, addresseeId: requesterId },
        ],
      },
    });

    if (existing) {
      if (existing.status === ConnectionStatus.ACCEPTED) {
        throw new ConflictException('You are already connected');
      }

      if (existing.status === ConnectionStatus.PENDING) {
        throw new ConflictException('A connection request is already pending');
      }

      if (existing.status === ConnectionStatus.BLOCKED) {
        throw new ForbiddenException('Unable to send a request to this number');
      }

      // A previously declined request can be sent again.
      await this.prisma.connection.update({
        where: { id: existing.id },
        data: { status: ConnectionStatus.PENDING, respondedAt: null },
      });

      return this.findById(existing.id);
    }

    const connection = await this.prisma.connection.create({
      data: {
        requesterId,
        addresseeId: addressee.id,
        status: ConnectionStatus.PENDING,
      },
      include: connectionInclude,
    });

    return connection;
  }

  list(userId: string, dto: ListConnectionsDto) {
    const status = dto.status ?? ConnectionStatus.ACCEPTED;
    const scope = dto.scope ?? 'all';

    const where: Prisma.ConnectionWhereInput = {
      status,
      ...(scope === 'incoming'
        ? { addresseeId: userId }
        : scope === 'outgoing'
          ? { requesterId: userId }
          : { OR: [{ requesterId: userId }, { addresseeId: userId }] }),
    };

    return this.prisma.connection.findMany({
      where,
      include: connectionInclude,
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Accepts, declines or blocks an incoming request. Only the addressee may
   * respond to their own incoming request.
   */
  async respond(
    connectionId: string,
    userId: string,
    dto: UpdateConnectionDto,
  ) {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (dto.status === ConnectionStatus.BLOCKED) {
      // Either party may block the other at any time.
      if (
        connection.requesterId !== userId &&
        connection.addresseeId !== userId
      ) {
        throw new ForbiddenException('Not allowed to modify this connection');
      }

      return this.prisma.connection.update({
        where: { id: connectionId },
        data: { status: ConnectionStatus.BLOCKED, respondedAt: new Date() },
        include: connectionInclude,
      });
    }

    if (connection.addresseeId !== userId) {
      throw new ForbiddenException(
        'Only the recipient can respond to this request',
      );
    }

    if (connection.status !== ConnectionStatus.PENDING) {
      throw new ConflictException('This request has already been handled');
    }

    return this.prisma.connection.update({
      where: { id: connectionId },
      data: { status: dto.status, respondedAt: new Date() },
      include: connectionInclude,
    });
  }

  /** Removes a connection from either side. */
  async remove(connectionId: string, userId: string) {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    if (
      connection.requesterId !== userId &&
      connection.addresseeId !== userId
    ) {
      throw new ForbiddenException('Not allowed to remove this connection');
    }

    await this.prisma.connection.delete({ where: { id: connectionId } });

    return { success: true };
  }

  findConnectionBetween(userId: string, otherUserId: string) {
    return this.prisma.connection.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: userId },
        ],
      },
      include: connectionInclude,
    });
  }

  /**
   * True when the two users have an accepted connection, and neither has
   * blocked the other. Used to gate conversation creation.
   */
  async areConnected(userId: string, otherUserId: string): Promise<boolean> {
    const connection = await this.prisma.connection.findFirst({
      where: {
        status: ConnectionStatus.ACCEPTED,
        OR: [
          { requesterId: userId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: userId },
        ],
      },
      select: { id: true },
    });

    return connection !== null;
  }

  /**
   * Filters `userIds` down to those already connected to `userId`.
   * Used when adding members to a group so unconnected people cannot be
   * pulled into a conversation.
   */
  async areConnectedMany(
    userId: string,
    userIds: string[],
  ): Promise<Set<string>> {
    if (userIds.length === 0) {
      return new Set();
    }

    const connections = await this.prisma.connection.findMany({
      where: {
        status: ConnectionStatus.ACCEPTED,
        OR: [
          { requesterId: userId, addresseeId: { in: userIds } },
          { requesterId: { in: userIds }, addresseeId: userId },
        ],
      },
      select: { requesterId: true, addresseeId: true },
    });

    const connected = new Set<string>();

    for (const connection of connections) {
      connected.add(
        connection.requesterId === userId
          ? connection.addresseeId
          : connection.requesterId,
      );
    }

    return connected;
  }

  /** True when either user has blocked the other. */
  async isBlocked(userId: string, otherUserId: string): Promise<boolean> {
    const connection = await this.prisma.connection.findFirst({
      where: {
        status: ConnectionStatus.BLOCKED,
        OR: [
          { requesterId: userId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: userId },
        ],
      },
      select: { id: true },
    });

    return connection !== null;
  }

  private findById(id: string) {
    return this.prisma.connection.findUniqueOrThrow({
      where: { id },
      include: connectionInclude,
    });
  }
}

function describeState(
  requesterId: string,
  connection: { status: ConnectionStatus; requesterId: string } | null,
) {
  if (!connection) {
    return { status: 'NONE' as const, outgoing: false };
  }

  return {
    status: connection.status,
    outgoing: connection.requesterId === requesterId,
  };
}
