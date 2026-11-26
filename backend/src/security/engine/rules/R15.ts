/** R15 숨은 유니코드. 양방향 제어문자(Trojan Source)는 위험, 제로폭 문자는 주의. */
import type { Hit, Rule } from '../types';

// 소스에 제어문자가 리터럴로 남지 않도록 이스케이프 문자열로 조립(포매터가 리터럴로 풀어버림)
const BIDI = new RegExp(String.raw`[\u202A-\u202E\u2066-\u2069]`);
// 제로폭·방향 표식(LRM/RLM)·단어 결합자 등. U+FEFF는 파일 선두 BOM이 아닌 중간 위치에서만 신호
const ZERO_WIDTH = new RegExp(String.raw`[\u200B-\u200F\u2060-\u2064\uFEFF]`);
// Unicode Tag 문자: ASCII를 눈에 안 보이게 인코딩해 LLM에 지시를 숨기는 스머글링에 쓰인다
const TAG_CHARS = new RegExp(String.raw`[\u{E0000}-\u{E007F}]`, 'u');
// 깃발 이모지(🏴 + 태그 시퀀스)는 정상 사용
const FLAG_TAGS = new RegExp(String.raw`\u{1F3F4}[\u{E0020}-\u{E007F}]+`, 'gu');
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
    '눈에 보이지 않는 문자가 섞여 있습니다. 방향 제어문자는 화면에 보이는 코드와 실제 실행되는 코드를 다르게 만들 수 있습니다(Trojan Source). 제로폭·방향 표식 문자는 주의, 눈에 안 보이는 Tag 문자(숨은 지시)는 위험 신호입니다.',
  regions: ['shell', 'script', 'skill-meta', 'prose', 'mcp', 'marketplace'],
  // 전처리(주석 제거·줄 잇기) 전 원문을 본다 — 주석 속에 숨긴 제어문자도 잡아야 하므로
  match({ target }) {
    const hits: Hit[] = [];
    target.text.split(/\r?\n/).forEach((text, i) => {
      // 파일 맨 앞 BOM은 인코딩 표지일 뿐
      const body = i === 0 ? text.replace(/^\uFEFF/, '') : text;
      if (BIDI.test(body) || TAG_CHARS.test(body.replace(FLAG_TAGS, '')))
        hits.push({ line: i + 1, text, severity: 'DANGER' });
      else if (ZERO_WIDTH.test(body.replace(EMOJI_ZWJ, '')))
        hits.push({ line: i + 1, text, severity: 'CAUTION' });
    });
    return hits;
  },
};
