// 항목 상세: 30일 스타 차트, 한국어 요약 + README 원문 인용(설치 명령·경고), 위험 신호 탐지 패널(면책·오탐 신고).
// 요약·발췌·명령은 모두 React 텍스트 노드로만 렌더한다(HTML/마크다운 해석 금지).
import { ArrowUpRight, Flag } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useItemDetail, useRules, useStarSeries } from "../api/queries";
import { BookmarkButton } from "../components/BookmarkButton";
import { StarChart } from "../components/StarChart";
import { Bevel, ErrorBox, KindTag, LevelBadge, Loading, PillLink, QueryState } from "../components/ui";
import { LEVEL_LABEL } from "../components/labels";
import { falsePositiveIssueUrl, permalink } from "../shared/links";
import { sparklineGain } from "../shared/format";
import type { Finding, ItemDetail as Detail } from "../shared/schemas";

const ISSUES_REPO: string = import.meta.env.VITE_ISSUES_REPO ?? "jakesoneyo/kok-gg";
const NUM = (n: number) => n.toLocaleString("en-US");

function Chart({ itemId, name }: { itemId: number; name: string }) {
  const q = useStarSeries(itemId, 30);
  return (
    <QueryState isPending={q.isPending} error={q.error} empty={q.data?.series.length === 0} emptyText="스타 기록이 아직 없습니다." onRetry={() => void q.refetch()}>
      {q.data && <StarChart series={q.data.series} name={name} />}
    </QueryState>
  );
}

function Summary({ d }: { d: Detail }) {
  const s = d.summary;
  return (
    <Bevel>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 className="text-base font-semibold">한국어 사용 요약</h3>
        <a href={d.repo.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center text-xs text-ink-3 underline underline-offset-3">
          AI 생성 요약 · 원문 확인
        </a>
      </div>
      {!s && <p className="mt-3.5 text-muted">요약을 생성하는 중입니다. 다음 갱신 때 표시됩니다.</p>}
      {s?.status === "INSUFFICIENT" && <p className="mt-3.5 text-muted">정보 부족: README에 사용법이 충분히 적혀 있지 않아 요약하지 않았습니다. 원문을 확인해 주세요.</p>}
      {s?.status === "OK" && (
        <>
          <p className="mt-3.5 max-w-[68ch] text-[15.5px] leading-[1.8] text-ink-2">{s.summaryKo}</p>
          {s.useCasesKo.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {s.useCasesKo.map((u) => (
                <li key={u} className="inline-flex min-h-[34px] items-center rounded-full bg-[#f3f5fa] px-3.5 text-[13.5px] text-ink-2">
                  {u}
                </li>
              ))}
            </ul>
          )}
          {s.installCommands.length > 0 && (
            <>
              <figure className="mt-6 rounded-card bg-[#e9ecf4] p-[5px]">
                <figcaption className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2.5 pt-2 text-xs text-[#3d4763]">
                  <span className="font-semibold">설치 명령</span>
                  <span className="inline-flex h-[22px] items-center rounded-full bg-surface px-2.5 font-medium">README 원문 인용</span>
                </figcaption>
                <pre className="overflow-x-auto rounded-[17px] bg-code px-5 py-[18px] font-mono text-[13.5px] leading-[1.9] text-[#e6eaf5] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  <code>
                    {s.installCommands.map((c) => (
                      <span key={c.command} className="block">
                        <span className="text-[#8f9ab8]">$ </span>
                        {c.command}
                      </span>
                    ))}
                  </code>
                </pre>
              </figure>
              <InstallWarnings commands={s.installCommands} />
            </>
          )}
          {s.requirementsKo.length > 0 && (
            <dl className="mt-5 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted">요구사항</dt>
              <dd className="text-ink-2">{s.requirementsKo.join(", ")}</dd>
            </dl>
          )}
        </>
      )}
    </Bevel>
  );
}

/** 설치 명령 경고(ruleId 배열). 규칙 제목 조회에 실패해도 ruleId 로 표시. */
function InstallWarnings({ commands }: { commands: { command: string; warnings: string[] }[] }) {
  const rules = useRules();
  const title = (id: string) => rules.data?.rules.find((r) => r.id === id)?.titleKo ?? id;
  const flagged = commands.filter((c) => c.warnings.length > 0);
  if (flagged.length === 0)
    return <p className="mt-2.5 text-[13px] text-ink-3">인용한 설치 명령 자체에서는 위험 신호가 탐지되지 않았습니다.</p>;
  return (
    <ul className="mt-2.5 space-y-1.5" aria-label="설치 명령 경고">
      {flagged.map((c) => (
        <li key={c.command} className="rounded-xl bg-caution px-3.5 py-2.5 text-[13px] text-caution-ink">
          <code className="font-mono">{c.command}</code>
          <span className="block font-semibold">경고: {c.warnings.map(title).join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}

function FindingCard({ f, d }: { f: Finding; d: Detail }) {
  const rules = useRules();
  const desc = rules.data?.rules.find((r) => r.id === f.ruleId)?.descriptionKo;
  const where = `${f.filePath}:${f.line}`;
  const href = permalink(d.repo.url, d.security?.headSha ?? null, f.filePath, f.line);
  return (
    <li className={`rounded-[18px] bg-[#f5f7fb] p-4 shadow-[inset_0_0_0_1px_rgba(30,45,90,0.05)] ${f.suppressed ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2.5">
          <LevelBadge level={f.severity} />
          <span className="text-[15px] font-semibold">{f.titleKo}</span>
          {f.suppressed && <span className="rounded-full bg-chip px-2 py-0.5 text-xs text-ink-3">관리자 예외 처리됨</span>}
        </span>
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-xs text-ink-3 underline underline-offset-3">
            원문 보기<span className="sr-only">({where})</span>
          </a>
        )}
      </div>
      <pre className="mt-3 overflow-x-auto rounded-xl bg-surface px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed shadow-[inset_0_0_0_1px_rgba(30,45,90,0.07)]">
        <code>
          <span className="font-semibold text-accent">{where}</span>
          {"  "}
          {f.excerpt}
        </code>
      </pre>
      {desc && <p className="mt-2.5 text-[13px] leading-relaxed text-ink-3">{desc}</p>}
      {f.override && <p className="mt-2.5 text-[13px] text-ink-3">예외 사유: {f.override.reason}</p>}
      <a
        href={falsePositiveIssueUrl(ISSUES_REPO, { itemId: d.item.id, itemName: d.item.name, fingerprint: f.fingerprint })}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-xs text-ink-3 underline underline-offset-3"
      >
        <Flag size={12} aria-hidden="true" />이 신호 오탐 신고
      </a>
    </li>
  );
}

function SecurityPanel({ d }: { d: Detail }) {
  const sec = d.security;
  const unavailable = sec !== null && sec.status !== "ANALYZED";
  const findings = sec?.findings ?? [];
  const active = findings.filter((f) => !f.suppressed);
  const count = (lv: "DANGER" | "CAUTION") => active.filter((f) => f.severity === lv).length;
  return (
    <Bevel className="min-w-0 flex-[1_1_420px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">위험 신호 탐지</h3>
        <LevelBadge level={sec?.level ?? null} unavailable={unavailable} size="lg" />
      </div>
      {!sec && <p className="mt-3 text-sm text-muted">아직 검사 전입니다. 다음 수집 때 검사됩니다.</p>}
      {unavailable && <p className="mt-3 text-sm text-muted">이 항목은 분석할 수 없습니다 ({sec.status === "TOO_LARGE" ? "파일이 너무 큼" : sec.status === "UNSUPPORTED" ? "지원하지 않는 형식" : "분석 중 오류"}).</p>}
      {sec?.status === "ANALYZED" && (
        <>
          <p className="mt-2 text-[13px] text-muted">
            규칙셋 v{sec.ruleSetVersion}, {sec.scannedAt.slice(0, 16).replace("T", " ")} 검사, 신호 {active.length}건 (위험 {count("DANGER")}, 주의 {count("CAUTION")})
          </p>
          {findings.length === 0 ? (
            <p className="mt-5 text-sm text-ink-2">탐지된 위험 신호가 없습니다. 그래도 {LEVEL_LABEL.SAFE} 등급이 안전을 보증하지는 않습니다.</p>
          ) : (
            <ol className="mt-5 flex flex-col gap-2.5">
              {findings.map((f) => (
                <FindingCard key={f.fingerprint} f={f} d={d} />
              ))}
            </ol>
          )}
        </>
      )}
      <div className="mt-5 rounded-[18px] bg-accent/8 p-[18px] shadow-[inset_0_0_0_1px_rgba(51,85,214,0.2)]">
        <p className="text-sm font-semibold leading-relaxed">위험 신호 탐지 결과이며 안전을 보증하지 않습니다.</p>
        <p className="mt-1.5 text-[13px] leading-[1.65] text-[#3d4763]">{sec?.disclaimerKo ?? "판정은 규칙 엔진만 수행합니다. 잘못 탐지된 신호라면 항목 정보가 미리 채워진 양식으로 알려 주세요."}</p>
        <a
          href={falsePositiveIssueUrl(ISSUES_REPO, { itemId: d.item.id, itemName: d.item.name })}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3.5 inline-flex min-h-11 items-center gap-2.5 rounded-full bg-surface pl-[18px] pr-1.5 text-sm font-semibold text-accent shadow-[0_1px_2px_rgba(20,30,60,0.06),0_6px_14px_-8px_rgba(20,30,60,0.2)]"
        >
          오탐 신고 (GitHub Issue)
          <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded-full bg-accent/8">
            <ArrowUpRight size={14} />
          </span>
        </a>
      </div>
    </Bevel>
  );
}

export function ItemDetail() {
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const q = useItemDetail(id);
  if (!valid) return <ErrorBox error={new Error("bad id")} />;
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const owner = d.repo.fullName.split("/")[0];
  const rank7 = d.trend.D7;
  return (
    <section aria-labelledby="detail-h" className="bg-wash">
      <div className="mx-auto max-w-[1240px] px-4 pb-24 pt-12 sm:px-6">
        <Link to="/catalog" className="inline-flex h-7 items-center rounded-full bg-surface px-3 text-xs font-medium text-ink-3 shadow-hair">
          카탈로그로
        </Link>
        <div className="mt-[18px] flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <KindTag kind={d.item.kind} />
              {rank7 && <span className="text-[13px] text-ink-3">7일 {rank7.rank}위</span>}
              {d.repo.archived && <span className="rounded-full bg-chip px-2.5 py-0.5 text-xs">보관됨(archived)</span>}
            </div>
            <h1 id="detail-h" className="mt-3 font-mono text-[26px] font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[32px]">
              <span className="font-medium text-muted">{owner}/</span>
              {d.item.name}
            </h1>
            {d.item.description && <p className="mt-2 max-w-[70ch] text-sm text-ink-3">{d.item.description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PillLink href={d.repo.url}>GitHub에서 보기</PillLink>
            <BookmarkButton itemId={d.item.id} label={d.item.name} withText />
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-5">
            <Bevel>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold">스타 추이 (30일)</h3>
                  <p className="mt-1.5 text-[13px] text-muted">음영 구간이 최근 7일입니다. 데이터가 없는 날은 선이 끊겨요.</p>
                </div>
                <dl className="flex flex-wrap gap-x-7 gap-y-2">
                  <Stat label="7일 증가" value={<GainHero id={d.item.id} />} hero />
                  <Stat label="총 스타" value={NUM(d.repo.stars)} />
                  <Stat label="Trend Score" value={rank7 ? rank7.score.toFixed(1) : "–"} />
                </dl>
              </div>
              <div className="mt-6">
                <Chart itemId={d.item.id} name={d.item.name} />
              </div>
            </Bevel>
            <Summary d={d} />
          </div>
          <SecurityPanel d={d} />
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, hero = false }: { label: string; value: React.ReactNode; hero?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={hero ? "mt-0.5 text-[34px] font-bold tracking-[-0.04em] text-accent" : "mt-0.5 pt-2.5 text-xl font-semibold tracking-tight"}>{value}</dd>
    </div>
  );
}

/** 7일 증가량은 스타 시계열의 최근 7일 gain 합(차트와 같은 쿼리 캐시를 공유). */
function GainHero({ id }: { id: number }) {
  const q = useStarSeries(id, 30);
  if (!q.data) return <>–</>;
  const g = sparklineGain(q.data.series.slice(-7).map((p) => p.gain));
  return <>{g === null ? "–" : `+${NUM(g)}`}</>;
}
