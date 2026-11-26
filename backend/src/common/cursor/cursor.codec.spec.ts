import { z } from 'zod';
import { DomainException } from '../errors/domain-exception';
import { decodeCursor, encodeCursor } from './cursor.codec';

const trending = z.object({
  s: z.literal('trending'),
  v: z.number(),
  id: z.number().int(),
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainException ? e.code : 'OTHER';
  }
}

describe('cursor codec', () => {
  it('왕복해도 값이 보존된다(Float 포함)', () => {
    const payload = { s: 'trending', v: 1088.4, id: 812 };
    expect(decodeCursor(encodeCursor(payload), trending)).toEqual(payload);
  });

  it('base64url만 쓴다(+ / = 없음)', () => {
    expect(encodeCursor({ s: 'trending', v: 1e21, id: 1 })).toMatch(
      /^[A-Za-z0-9_-]+$/,
    );
  });

  it('정렬이 다른 커서는 INVALID_CURSOR', () => {
    const stars = encodeCursor({ s: 'stars', v: 10, id: 1 });
    expect(codeOf(() => decodeCursor(stars, trending))).toBe('INVALID_CURSOR');
  });

  it('값 타입이 다르면 INVALID_CURSOR', () => {
    const bad = encodeCursor({ s: 'trending', v: 'x', id: 1 });
    expect(codeOf(() => decodeCursor(bad, trending))).toBe('INVALID_CURSOR');
  });

  it.each(['!!!', '', 'bm90LWpzb24'])('깨진 토큰 %p는 INVALID_CURSOR', (t) => {
    expect(codeOf(() => decodeCursor(t, trending))).toBe('INVALID_CURSOR');
  });
});
