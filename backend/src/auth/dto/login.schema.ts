import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * 데모 계정 규정(CLAUDE.md): email === 'admin' 리터럴 하나에 한해서만 이메일 형식 검증을 우회한다.
 * 그 값이 아닌 모든 비이메일 문자열은 여전히 400으로 거부된다. 회원가입 스키마에는 적용하지 않는다.
 */
export const loginSchema = z.object({
  email: z.union([
    z.literal('admin'),
    z.email('올바른 이메일 형식이 아닙니다.'),
  ]),
  password: z.string().min(1, '비밀번호를 입력해주세요.'),
});

export class LoginDto extends createZodDto(loginSchema) {}
