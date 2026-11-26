import { registerSchema } from './register.schema';

// IT-14 단위 버전: 'admin' 우회는 로그인에만 있고 가입에는 절대 적용되지 않는다.
describe('registerSchema', () => {
  const valid = {
    email: 'user@example.com',
    password: 'password1',
    name: '홍길동',
  };

  it('정상 입력을 통과시킨다', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it('email "admin"으로의 가입은 거부한다', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'admin' }).success).toBe(
      false,
    );
  });

  it('비밀번호 8자 미만·72자 초과를 거부한다', () => {
    expect(
      registerSchema.safeParse({ ...valid, password: 'short' }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...valid, password: 'x'.repeat(73) }).success,
    ).toBe(false);
  });
});
