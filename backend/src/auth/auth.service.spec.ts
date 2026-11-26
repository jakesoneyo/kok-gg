import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

/**
 * DB/JWT 없이 순수 로직만 검증한다(실제 DB 연동은 C1 통합 테스트).
 * 핵심: 비밀번호는 항상 실제 bcrypt.compare를 통과해야 하고, 우회 경로가 없어야 한다.
 */
describe('AuthService', () => {
  const REAL_PASSWORD = 'correct-horse-battery-staple';
  let passwordHash: string;

  const findUniqueUser = jest.fn();
  const createRefreshToken = jest.fn();
  const signAsync = jest.fn();
  let service: AuthService;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(REAL_PASSWORD, 4); // 테스트 전용 낮은 cost
  });

  beforeEach(() => {
    findUniqueUser.mockReset();
    createRefreshToken.mockReset().mockResolvedValue({});
    signAsync.mockReset().mockResolvedValue('signed.jwt.token');
    // 부분 모킹이라 Prisma Delegate 전체 타입을 만족하지 않는다 — 의도적으로 이중 단언한다.
    const prismaMock = {
      user: { findUnique: findUniqueUser },
      refreshToken: { create: createRefreshToken },
    } as unknown as PrismaService;
    service = new AuthService(prismaMock, {
      signAsync,
    } as unknown as JwtService);
  });

  const demoUser = {
    id: 1,
    email: 'admin',
    name: '데모 관리자',
    role: 'ADMIN',
    passwordHash: '',
    createdAt: new Date(),
  };

  it('올바른 비밀번호면 로그인에 성공하고 토큰을 발급한다', async () => {
    findUniqueUser.mockResolvedValue({ ...demoUser, passwordHash });
    const result = await service.login({
      email: 'admin',
      password: REAL_PASSWORD,
    });
    expect(result.user).toEqual({
      id: 1,
      email: 'admin',
      name: '데모 관리자',
      role: 'ADMIN',
    });
    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.refreshToken).toEqual(expect.any(String));
  });

  it('잘못된 비밀번호는 admin 계정도 401(bcrypt 우회 없음)', async () => {
    findUniqueUser.mockResolvedValue({ ...demoUser, passwordHash });
    await expect(
      service.login({ email: 'admin', password: 'wrong-password' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });

  it('존재하지 않는 사용자도 동일한 401(계정 존재 여부 미노출)', async () => {
    findUniqueUser.mockResolvedValue(null);
    await expect(
      service.login({ email: 'nobody@example.com', password: 'whatever' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });
});
