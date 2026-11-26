/** R15 숨은 유니코드. 양방향 제어문자(Trojan Source)는 위험, 제로폭 문자는 주의. */
import type { Hit, Rule } from '../types';

// 소스에 제어문자가 리터럴로 남지 않도록 이스케이프 문자열로 조립(포매터가 리터럴로 풀어버림)
const BIDI = new RegExp(String.raw`[\u202A-\u202E\u2066-\u2069]`);
const ZERO_WIDTH = new RegExp(String.raw`[\u200B-\u200D]`);
// 이모지 결합용 ZWJ(가족 이모지 등)는 정상 사용이므로 신호에서 뺀다
const EMOJI_ZWJ = new RegExp(
  String.raw`(?<=[\p{Extended_Pictographic}\uFE0F])\u200D(?=\p{Extended_Pictographic})`,
  'gu',
);

export const R15: Rule = {
  id: 'R15_HIDDEN_UNICODE',
  severity: 'DANGER',
  severities: ['CAUTION', 'DANGER'],
  titleKo: '숨은 유니코드 문자',
  descriptionKo:
    '눈에 보이지 않는 문자가 섞여 있습니다. 방향 제어문자는 화면에 보이는 코드와 실제 실행되는 코드를 다르게 만들 수 있습니다(Trojan Source). 제로폭 문자는 주의 신호입니다.',
  regions: ['shell', 'script', 'skill-meta', 'prose', 'mcp', 'marketplace'],
  // 전처리(주석 제거·줄 잇기) 전 원문을 본다 — 주석 속에 숨긴 제어문자도 잡아야 하므로
  match({ target }) {
    const hits: Hit[] = [];
    target.text.split(/\r?\n/).forEach((text, i) => {
      if (BIDI.test(text)) hits.push({ line: i + 1, text, severity: 'DANGER' });
      else if (ZERO_WIDTH.test(text.replace(EMOJI_ZWJ, '')))
        hits.push({ line: i + 1, text, severity: 'CAUTION' });
    });
    return hits;
  },
};
