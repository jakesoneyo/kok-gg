// 30일 누적 스타 선 차트(Recharts). gain 을 모르는 날은 선이 끊기고(connectNulls=false), 최근 7일은 음영.
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartSummary, mapStarSeries } from "../shared/chart";
import type { StarSeries } from "../shared/schemas";

export function StarChart({ series, name }: { series: StarSeries["series"]; name: string }) {
  const points = mapStarSeries(series);
  const { gain7d, unknownDays } = chartSummary(points);
  const known = points.filter((p) => p.total !== null);
  const last7Start = points[Math.max(0, points.length - 7)]?.label;
  const alt =
    `${name} 최근 ${points.length}일 누적 스타 추이 선 차트. ` +
    (known.length ? `${known[0].label} ${known[0].total?.toLocaleString("en-US")}개에서 ${known.at(-1)?.label} ${known.at(-1)?.total?.toLocaleString("en-US")}개로 변화. ` : "") +
    `최근 7일 증가 ${gain7d.toLocaleString("en-US")}개.` +
    (unknownDays ? ` 데이터가 없는 날 ${unknownDays}일은 선이 끊깁니다.` : "");
  return (
    <div role="img" aria-label={alt} className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e6e9f2" vertical={false} />
          {last7Start && <ReferenceArea x1={last7Start} x2={points.at(-1)?.label} fill="var(--color-accent)" fillOpacity={0.08} />}
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5f6982" }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={{ fontSize: 11, fill: "#5f6982" }} tickLine={false} axisLine={false} width={44} domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => v.toLocaleString("en-US")} />
          <Tooltip
            formatter={(v, _n, item) => [v === null || v === undefined ? "데이터 없음" : Number(v).toLocaleString("en-US"), `누적 스타 (일 증가 ${item.payload.gain ?? "알 수 없음"})`]}
            labelStyle={{ color: "#121a2f" }}
          />
          <Line type="monotone" dataKey="total" stroke="var(--color-accent)" strokeWidth={2.2} dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
