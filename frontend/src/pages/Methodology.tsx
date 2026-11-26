// 방법론: Trend Score 요약 + 위험 신호 규칙표(/security/rules, 규칙 메타 SSOT) + 알려진 한계.
import { useRules } from "../api/queries";
import { Bevel, LevelBadge, QueryState } from "../components/ui";

export function Methodology() {
  const q = useRules();
  return (
    <section aria-labelledby="m-h" className="mx-auto max-w-[900px] px-4 pb-24 pt-12 sm:px-6">
      <h1 id="m-h" className="text-[30px] font-bold tracking-[-0.035em] sm:text-4xl">방법론</h1>
      <Bevel className="mt-6">
        <h2 className="text-lg font-semibold">Trend Score</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-[1.7] text-ink-2">
          <li>저장소 단위로 계산합니다. 기간(1일·7일·30일) 동안의 스타 증가량을 저장소 규모로 보정한 일평균 속도가 기본 점수예요.</li>
          <li>직전 기간 대비 가속도는 보조 신호로만 반영하고, 하루에 증가량이 몰리는 급등은 감점합니다.</li>
          <li>스타 이력은 GitHub API 스냅샷과 공식 스타 기록을 교차검증합니다. 모르는 날은 0이 아니라 “모름”으로 두고, 데이터 커버리지가 부족하면 순위에서 제외합니다.</li>
          <li>증가량·활동일·커버리지 기준을 넘지 못한 저장소는 순위에 나타나지 않습니다.</li>
        </ul>
      </Bevel>
      <Bevel className="mt-5">
        <h2 id="rules" className="text-lg font-semibold">위험 신호 탐지 규칙</h2>
        <QueryState isPending={q.isPending} error={q.error} onRetry={() => void q.refetch()}>
          {q.data && (
            <>
              <p className="mt-2 text-[13px] text-muted">규칙셋 v{q.data.ruleSetVersion}</p>
              <p className="mt-3 rounded-2xl bg-accent/8 p-4 text-sm leading-relaxed text-ink-2">{q.data.disclaimerKo}</p>
              <ul className="mt-4 space-y-3">
                {q.data.rules.map((r) => (
                  <li key={r.id} className="rounded-[18px] bg-[#f5f7fb] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{r.titleKo}</span>
                      <span className="font-mono text-xs text-muted">{r.id}</span>
                      {r.severities.map((s) => <LevelBadge key={s} level={s} />)}
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{r.descriptionKo}</p>
                    <p className="mt-1 text-xs text-muted">검사 영역: {r.regions.join(", ")}</p>
                  </li>
                ))}
              </ul>
              <h3 className="mt-6 text-base font-semibold">알려진 한계</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-2">
                {q.data.knownLimitsKo.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </>
          )}
        </QueryState>
      </Bevel>
    </section>
  );
}
