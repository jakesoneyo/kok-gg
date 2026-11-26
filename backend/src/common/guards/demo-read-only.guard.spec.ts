import type { ExecutionContext } from '@nestjs/common';
import { DemoReadOnlyGuard } from './demo-read-only.guard';

const ctx = (method: string, email: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ method, user: { email } }) }),
  }) as unknown as ExecutionContext;

describe('DemoReadOnlyGuard', () => {
  const guard = new DemoReadOnlyGuard();
  afterEach(() => delete process.env.DEMO_ADMIN_READONLY);

  it('플래그 꺼짐: 모두 통과', () => {
    expect(guard.canActivate(ctx('POST', 'admin'))).toBe(true);
  });

  it('플래그 켜짐: admin의 비-GET만 403 DEMO_READ_ONLY', () => {
    process.env.DEMO_ADMIN_READONLY = 'true';
    expect(guard.canActivate(ctx('GET', 'admin'))).toBe(true);
    expect(guard.canActivate(ctx('POST', 'other@x.com'))).toBe(true);
    expect(() => guard.canActivate(ctx('PATCH', 'admin'))).toThrow(
      expect.objectContaining({ code: 'DEMO_READ_ONLY' }) as Error,
    );
  });
});
