import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** 회원가입은 항상 실이메일만 받는다 — 'admin' 우회는 로그인 스키마에만 존재한다. bcrypt 입력 한도 72바이트(API.md 2장). */
export const registerSchema = z.object({
  email: z.email('올바른 이메일 형식이 아닙니다.'),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.').max(72),
  name: z.string().min(1, '이름을 입력해주세요.').max(40),
});

export class RegisterDto extends createZodDto(registerSchema) {}
