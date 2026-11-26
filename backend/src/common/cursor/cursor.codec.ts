// keyset 커서 코덱: 정렬 키 값을 base64url(JSON)로 감싼다. 서명은 하지 않는다(DATA-MODEL 6.3 — 위조해도 공개 목록의 임의 위치일 뿐).
import type { z } from 'zod';
import { DomainException } from '../errors/domain-exception';

/**
 * 정렬 키 값을 불투명 토큰으로 인코딩한다. 서명하지 않으므로 신뢰하지 말고 decodeCursor로 검증해 쓴다.
 *
 * @param payload JSON 직렬화 가능한 키 값 · @returns base64url 문자열
 */
export function encodeCursor(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * 토큰을 해석해 `schema`로 검증한다.
 * 정렬 일치 검사는 호출자가 `s: z.literal(sort)`를 스키마에 넣어 위임한다 — 다른 정렬의 커서로 이어 읽어
 * 항목이 중복·누락되는 버그를 400으로 막는다.
 *
 * @throws DomainException 400 INVALID_CURSOR — 디코드 실패·정렬 불일치·값 타입 불일치
 */
export function decodeCursor<T>(token: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    raw = undefined;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainException(
      400,
      'INVALID_CURSOR',
      '정렬 방식과 맞지 않는 커서입니다.',
    );
  }
  return parsed.data;
}
