import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { UserStatus } from '../generated/prisma/client';
import { EnvConfig } from '../config/env.validation';
import { parseDuration } from '../common/utils/duration.util';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthResult, AuthTokens } from './types/auth-tokens.type';

interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly bcryptRounds = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async register(dto: RegisterDto, context: RequestContext = {}) {
    const email = dto.email.toLowerCase();
    const existingUser = await this.usersService.findByEmail(email);

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);
    const name = dto.name.trim();

    // Allocate the private number first, then create the session inside a
    // transaction so a user is never persisted without a valid session.
    const user = await this.usersService.createWithUniqueConnectNumber({
      email,
      passwordHash,
      name,
      status: UserStatus.ACTIVE,
      lastLoginAt: new Date(),
    });

    const tokens = await this.createSessionAndTokens(
      user.id,
      user.email,
      context,
    );

    return this.toAuthResult(user, tokens);
  }

  async login(dto: LoginDto, context: RequestContext = {}) {
    const user = await this.usersService.findByEmail(dto.email.toLowerCase());

    // Always run a bcrypt comparison so a missing user and a wrong password
    // take a similar amount of time (avoids leaking which emails exist).
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = await bcrypt.compare(dto.password, passwordHash);

    if (!user || !user.passwordHash || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    await this.usersService.touchLastLogin(user.id);

    const tokens = await this.createSessionAndTokens(
      user.id,
      user.email,
      context,
    );

    return this.toAuthResult(user, tokens);
  }

  /**
   * Rotates the refresh token: the presented one is revoked and a brand new
   * pair is issued. Presenting an already-revoked token fails, which limits
   * the damage if a token is replayed.
   */
  async refresh(refreshToken: string, context: RequestContext = {}) {
    const refreshTokenHash = this.hashToken(refreshToken);

    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash },
      include: { user: true },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.deletedAt ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.createSessionAndTokens(
      session.user.id,
      session.user.email,
      context,
    );

    return this.toAuthResult(session.user, tokens);
  }

  async logout(refreshToken: string) {
    await this.prisma.authSession.updateMany({
      where: {
        refreshTokenHash: this.hashToken(refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  }

  getProfile(userId: string) {
    return this.usersService.findProfileById(userId);
  }

  private async createSessionAndTokens(
    userId: string,
    email: string,
    context: RequestContext,
  ): Promise<AuthTokens> {
    const refreshToken = randomBytes(48).toString('base64url');
    const accessExpiresIn = this.configService.get('JWT_ACCESS_EXPIRES_IN', {
      infer: true,
    });
    const refreshExpiresIn = this.configService.get('JWT_REFRESH_EXPIRES_IN', {
      infer: true,
    });

    await this.prisma.authSession.create({
      data: {
        userId,
        refreshTokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + parseDuration(refreshExpiresIn)),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });

    const accessToken = await this.jwtService.signAsync(
      { sub: userId, email, type: 'access' },
      {
        secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: accessExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );

    return { accessToken, refreshToken, expiresIn: accessExpiresIn };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toAuthResult(
    user: { id: string; email: string; name: string; connectNumber: string },
    tokens: AuthTokens,
  ): AuthResult {
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        connectNumber: user.connectNumber,
      },
      tokens,
    };
  }
}

// A pre-computed hash of a value no user can supply, used to keep the
// failed-login code path roughly constant time.
const DUMMY_PASSWORD_HASH =
  '$2b$12$Zf3sP8Q2vX9mL5nR7wK0eYcH1uT4aB6dF8gJ2kL5mN9pQ3rS7vW0xY';
