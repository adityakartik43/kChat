import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User, UserStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateConnectNumber } from '../common/utils/connect-number.util';
import { UpdateProfileDto } from './dto/update-profile.dto';

const CONNECT_NUMBER_MAX_ATTEMPTS = 12;

const publicUserSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  connectNumber: true,
  lastSeenAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });
  }

  findActiveById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { id, status: UserStatus.ACTIVE, deletedAt: null },
    });
  }

  /**
   * Creates a user, retrying with a fresh private number whenever the
   * randomly generated one collides with an existing user.
   */
  async createWithUniqueConnectNumber(
    data: Omit<Prisma.UserCreateInput, 'connectNumber'>,
  ): Promise<User> {
    for (let attempt = 0; attempt < CONNECT_NUMBER_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.user.create({
          data: { ...data, connectNumber: generateConnectNumber() },
        });
      } catch (error) {
        const isUniqueViolation =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';

        if (!isUniqueViolation) {
          throw error;
        }
      }
    }

    throw new ConflictException(
      'Could not allocate a private number, please try again',
    );
  }

  findProfileById(id: string) {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...publicUserSelect,
        email: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  findPublicById(id: string) {
    return this.prisma.user.findFirst({
      where: { id, status: UserStatus.ACTIVE, deletedAt: null },
      select: publicUserSelect,
    });
  }

  findPublicByConnectNumber(connectNumber: string) {
    return this.prisma.user.findFirst({
      where: { connectNumber, status: UserStatus.ACTIVE, deletedAt: null },
      select: publicUserSelect,
    });
  }

  async getPublicByIdOrFail(id: string) {
    const user = await this.findPublicById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  updateProfile(id: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
      },
      select: {
        ...publicUserSelect,
        email: true,
        status: true,
        createdAt: true,
      },
    });
  }

  touchLastSeen(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { lastSeenAt: new Date() },
    });
  }

  touchLastLogin(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }
}
