// 7일 스파크라인. null(모름) 구간은 선을 끊어 그린다 — 0으로 그리면 거짓 정보.
import { sparklinePoints } from "../shared/format";

export function Sparkline({ values, width = 64, height = 26 }: { values: (number | null)[]; width?: number; height?: number }) {
  const segs = sparklinePoints(values, width, height);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="flex-none">
      {segs.map((s, i) => (
        <polyline
          key={i}
          points={s.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
