// 표시용 순수 함수: 순위 변동, 증가량, 7일 스파크라인 좌표. 화면 로직을 테스트 가능하게 컴포넌트 밖에 둠.

export type RankTone = "up" | "down" | "flat" | "new";

/** 순위 변동 표기. NEW 가 delta 보다 우선하고, 미자격(delta=null)은 빈 문자열. */
export function formatRankChange({ delta, isNew }: { delta: number | null; isNew: boolean }): {
  text: string;
  tone: RankTone;
} {
  if (isNew) return { text: "NEW", tone: "new" };
  if (delta === null) return { text: "", tone: "flat" };
  if (delta > 0) return { text: `▲${delta}`, tone: "up" };
  if (delta < 0) return { text: `▼${-delta}`, tone: "down" };
  return { text: "–", tone: "flat" };
}

/** 트렌딩 행은 rankDelta 가 없어 클라이언트가 prevRank − rank 로 계산(API.md 3.2). */
export function trendRankChange(r: { rank: number; prevRank: number | null; isNew: boolean }) {
  return { delta: r.prevRank === null ? null : r.prevRank - r.rank, isNew: r.isNew };
}

/** 7일 증가량 히어로 지표: 부호를 붙여 천 단위 구분, 모르면 대시. */
export function formatGain(n: number | null): string {
  return n === null ? "–" : `+${n.toLocaleString("en-US")}`;
}

/** 스파크라인 일별 증가량 합. null(모름)을 0으로 취급하지 않고, 전부 모르면 null. */
export function sparklineGain(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

/** null 로 끊기는 구간별 폴리라인 좌표. 모름을 0으로 그리면 거짓 정보라서 구간을 나눈다. */
export function sparklinePoints(values: (number | null)[], width: number, height: number): [number, number][][] {
  const max = Math.max(1, ...values.filter((v): v is number => v !== null));
  const pad = 2;
  const step = (width - pad * 2) / (values.length - 1);
  const segments: [number, number][][] = [];
  let cur: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segments.push(cur);
      cur = [];
      return;
    }
    cur.push([pad + i * step, height - pad - (v / max) * (height - pad * 2)]);
  });
  if (cur.length) segments.push(cur);
  // 점 하나짜리 구간은 선이 안 보이므로 버림
  return segments.filter((s) => s.length > 1);
}
