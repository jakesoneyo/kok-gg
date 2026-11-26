import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DomainException } from '../common/errors/domain-exception';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.schema';
import { RegisterDto } from './dto/register.schema';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일
// Render 무료 CPU 기준 트레이드오프: cost 12는 콜드스타트 응답이 눈에 띄게 느려진다.
const BCRYPT_COST = 10;

type PrismaTx = Prisma.TransactionClient;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * 회원가입/로그인/리프레시 회전을 담당한다.
 * 비밀번호는 어떤 계정(데모 admin 포함)이든 항상 bcrypt.compare를 통과해야 한다 — 우회 경로 없음.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new DomainException(
        409,
        'AUTH_EMAIL_TAKEN',
        '이미 사용 중인 이메일입니다.',
      );
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.name },
    });
    return {
      user: this.toPublicUser(user),
      ...(await this.issueTokenPair(user)),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    // 계정 없음과 비밀번호 틀림을 하나의 예외로 합쳐 존재 여부를 노출하지 않는다.
    const passwordMatches = user
      ? await bcrypt.compare(dto.password, user.passwordHash)
      : false;
    if (!user || !passwordMatches) {
      throw new DomainException(
        401,
        'AUTH_INVALID_CREDENTIALS',
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }
    return {
      user: this.toPublicUser(user),
      ...(await this.issueTokenPair(user)),
    };
  }

  /**
   * 리프레시 회전 + 재사용 탐지. 이미 폐기된(=한 번 회전에 쓰인) 토큰이 다시 들어오면
   * 탈취로 간주해 같은 familyId 전체를 폐기한다.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
    });
    if (!stored) {
      throw new DomainException(
        401,
        'AUTH_REFRESH_INVALID',
        '유효하지 않은 refreshToken입니다.',
      );
    }
    if (stored.revokedAt) await this.rejectReuse(stored.familyId);
    if (stored.expiresAt < new Date()) {
      throw new DomainException(
        401,
        'AUTH_REFRESH_INVALID',
        '만료된 refreshToken입니다.',
      );
    }

    // 폐기 + 신규 발급은 원자적으로 — 하나만 반영되면 계열이 끊기거나 유효 토큰이 중복된다.
    // 위의 revokedAt 확인은 동시 요청 사이에서 무력하므로(둘 다 null을 봄), 조건부 updateMany의
    // count가 진짜 관문이다: 행 잠금 덕에 정확히 한 요청만 1을 받고 나머지는 재사용으로 처리된다.
    const rotated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count !== 1) return null;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: stored.userId },
      });
      return this.issueTokenPair(user, stored.familyId, tx);
    });
    return rotated ?? this.rejectReuse(stored.familyId);
  }

  /**
   * 폐기된 토큰의 재사용 = 탈취로 간주하고 계열 전체를 폐기한 뒤 401을 던진다.
   * 회전 트랜잭션과 별개로 즉시 커밋돼야 한다 — throw 이후 롤백되면 계열 폐기가 없던 일이 된다.
   */
  private async rejectReuse(familyId: string): Promise<never> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new DomainException(
      401,
      'AUTH_REFRESH_REUSE',
      '이미 사용된 refreshToken이 재사용되었습니다.',
    );
  }

  async logout(userId: number, refreshToken: string): Promise<void> {
    // 없거나 이미 폐기된 토큰이어도 조용히 204 — "내 세션 종료"에 정보 노출은 불필요하다.
    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash: this.hashToken(refreshToken),
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return { ...this.toPublicUser(user), isDemo: user.email === 'admin' };
  }

  private async issueTokenPair(
    user: User,
    familyId: string = randomUUID(),
    client: PrismaService | PrismaTx = this.prisma,
  ): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, jti: randomUUID() },
      { expiresIn: ACCESS_TOKEN_TTL },
    );
    const refreshTokenPlain = randomBytes(32).toString('base64url');
    await client.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshTokenPlain),
        familyId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return { accessToken, refreshToken: refreshTokenPlain };
  }

  /** 원문 refresh token은 저장하지 않는다 — DB 유출 시에도 토큰을 재구성할 수 없어야 한다. */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toPublicUser(user: User) {
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
