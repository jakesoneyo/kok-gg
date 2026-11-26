// 관리자 콘솔: 수집 실행·데이터 품질 이슈·보안 Override·AI 사용량.
// 데모 관리자(읽기 전용 운영)이면 변경 버튼을 비활성화하고 안내한다 — 서버의 403 DEMO_READ_ONLY 가 진짜 방어.
import { useState, type FormEvent } from "react";
import {
  useCreateOverride,
  useDqSummary,
  useHealth,
  useIssues,
  useOverrides,
  usePatchIssue,
  useRequestRun,
  useRevokeOverride,
  useRunDetail,
  useRuns,
} from "../api/queries";
import { Bevel, GhostButton, PrimaryButton, QueryState } from "../components/ui";
import { describeError } from "../lib/errors";
import { overrideInputSchema } from "../shared/schemas";
import { isDemoUser, useAuth } from "../store/auth";

const READ_ONLY_ENV = import.meta.env.VITE_DEMO_ADMIN_READONLY === "true";
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "–");

function MutationError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 text-sm text-danger">
      {describeError(error).message}
    </p>
  );
}

function Runs({ readOnly }: { readOnly: boolean }) {
  const runs = useRuns();
  const request = useRequestRun();
  const [sel, setSel] = useState<number | null>(null);
  const detail = useRunDetail(sel);
  return (
    <Bevel inner="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">수집 실행</h2>
        <PrimaryButton disabled={readOnly || request.isPending} onClick={() => request.mutate()}>
          수집 실행 요청
        </PrimaryButton>
      </div>
      <MutationError error={request.error} />
      {request.data && <p role="status" className="mt-2 text-sm text-ink-3">실행 #{request.data.runId} {request.data.dispatched ? "요청됨" : "등록됨(디스패치 대기)"}</p>}
      <QueryState isPending={runs.isPending} error={runs.error} empty={runs.items.length === 0} emptyText="실행 이력이 없습니다." onRetry={() => void runs.refetch()}>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">ID</th><th className="pr-3 font-medium">방식</th><th className="pr-3 font-medium">기준일</th><th className="pr-3 font-medium">상태</th><th className="pr-3 font-medium">시작</th><th className="font-medium">실패</th>
              </tr>
            </thead>
            <tbody>
              {runs.items.map((r) => (
                <tr key={r.id} className="border-t border-[#eef1f7]">
                  <td className="py-1"><button type="button" aria-pressed={sel === r.id} onClick={() => setSel(sel === r.id ? null : r.id)} className="min-h-11 cursor-pointer px-2 font-mono text-accent underline underline-offset-3">#{r.id}</button></td>
                  <td className="pr-3">{r.trigger}</td><td className="pr-3">{r.asOf ?? "–"}</td><td className="pr-3 font-semibold">{r.status}</td><td className="pr-3">{when(r.startedAt)}</td><td>{r.failureCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {runs.hasNextPage && <GhostButton className="mt-3" onClick={() => void runs.fetchNextPage()}>더 보기</GhostButton>}
      </QueryState>
      {sel !== null && (
        <div className="mt-4 rounded-2xl bg-[#f5f7fb] p-4">
          <QueryState isPending={detail.isPending} error={detail.error} onRetry={() => void detail.refetch()}>
            {detail.data && (
              <>
                <h3 className="text-sm font-semibold">실행 #{detail.data.run.id} 단계</h3>
                <ul className="mt-2 space-y-1 text-[13px]">
                  {detail.data.stages.map((s) => (
                    <li key={s.stage}><span className="font-mono">{s.stage}</span> {s.status}{s.error ? ` (${s.error})` : ""}</li>
                  ))}
                </ul>
                <h3 className="mt-3 text-sm font-semibold">최근 실패 {detail.data.failures.length}건</h3>
                <ul className="mt-2 space-y-1 text-[13px]">
                  {detail.data.failures.length === 0 && <li className="text-muted">실패 없음</li>}
                  {detail.data.failures.map((f, i) => (
                    <li key={i}><span className="font-mono">{f.stage}</span> {f.repoFullName ?? "-"} {f.code}: {f.message}</li>
                  ))}
                </ul>
              </>
            )}
          </QueryState>
        </div>
      )}
    </Bevel>
  );
}

function Quality({ readOnly }: { readOnly: boolean }) {
  const summary = useDqSummary();
  const health = useHealth();
  const [status, setStatus] = useState<"OPEN" | "RESOLVED" | "IGNORED">("OPEN");
  const issues = useIssues(status);
  const patch = usePatchIssue();
  const [note, setNote] = useState("");
  return (
    <Bevel inner="p-6">
      <h2 className="text-base font-semibold">데이터 품질 · AI 사용량</h2>
      <QueryState isPending={summary.isPending} error={summary.error} onRetry={() => void summary.refetch()}>
        {summary.data && (
          <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
            <dl>
              <dt className="text-xs text-muted">열린 이슈 (종류별)</dt>
              {Object.entries(summary.data.openByKind).map(([k, n]) => (
                <dd key={k} className="flex justify-between"><span className="font-mono text-[13px]">{k}</span><span className="font-semibold">{n}</span></dd>
              ))}
            </dl>
            <div>
              <p className="text-xs text-muted">오늘 AI 사용량 (USD)</p>
              {summary.data.aiUsageToday.length === 0 && <p className="text-muted">기록 없음</p>}
              {summary.data.aiUsageToday.map((u) => (
                <p key={u.pool}><span className="font-mono text-[13px]">{u.pool}</span> {u.spentUsd.toFixed(4)} / {u.capUsd.toFixed(2)} ({u.calls}회)</p>
              ))}
              <p className="mt-2 text-xs text-muted">
                AI 서버 상태: {health.data ? { ok: "정상", down: "응답 없음", unknown: "확인 전" }[health.data.ai] : "확인 전"}
                {summary.data.lastRun && ` · GitHub 호출 core ${summary.data.lastRun.ghCoreUsed} / search ${summary.data.lastRun.ghSearchUsed}`}
              </p>
            </div>
          </div>
        )}
      </QueryState>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted">이슈</span>
        {(["OPEN", "RESOLVED", "IGNORED"] as const).map((s) => (
          <GhostButton key={s} aria-pressed={status === s} onClick={() => setStatus(s)} className={status === s ? "!bg-accent/8 !text-accent" : ""}>
            {{ OPEN: "열림", RESOLVED: "해결", IGNORED: "무시" }[s]}
          </GhostButton>
        ))}
      </div>
      <QueryState isPending={issues.isPending} error={issues.error} empty={issues.items.length === 0} emptyText="해당 상태의 이슈가 없습니다." onRetry={() => void issues.refetch()}>
        <ul className="mt-3 space-y-2">
          {issues.items.map((i) => (
            <li key={i.id} className="rounded-2xl bg-[#f5f7fb] p-4 text-sm">
              <p><span className="font-mono text-[13px] font-semibold">{i.kind}</span> {i.repo.fullName} <span className="text-muted">{i.windowStart} ~ {i.windowEnd}</span></p>
              {i.note && <p className="mt-1 text-ink-3">메모: {i.note}</p>}
              {i.status === "OPEN" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`note-${i.id}`}>처리 메모</label>
                  <input id={`note-${i.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="처리 메모(필수)" className="min-h-11 min-w-0 flex-1 rounded-full bg-surface px-4 shadow-hair" />
                  <GhostButton disabled={readOnly || !note.trim() || patch.isPending} onClick={() => patch.mutate({ id: i.id, status: "RESOLVED", note })}>해결</GhostButton>
                  <GhostButton disabled={readOnly || !note.trim() || patch.isPending} onClick={() => patch.mutate({ id: i.id, status: "IGNORED", note })}>무시</GhostButton>
                </div>
              )}
            </li>
          ))}
        </ul>
        {issues.hasNextPage && <GhostButton className="mt-3" onClick={() => void issues.fetchNextPage()}>더 보기</GhostButton>}
        <MutationError error={patch.error} />
      </QueryState>
    </Bevel>
  );
}

function Overrides({ readOnly }: { readOnly: boolean }) {
  const list = useOverrides();
  const create = useCreateOverride();
  const revoke = useRevokeOverride();
  const [errors, setErrors] = useState<string | null>(null);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const raw = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const parsed = overrideInputSchema.safeParse(raw);
    if (!parsed.success) return setErrors(parsed.error.issues.map((i) => i.message).join(" / "));
    setErrors(null);
    create.mutate(parsed.data, { onSuccess: () => form.reset() });
  };
  const field = "min-h-11 w-full rounded-2xl bg-surface px-4 shadow-hair";
  return (
    <Bevel inner="p-6">
      <h2 className="text-base font-semibold">보안 예외 처리(Override)</h2>
      <QueryState isPending={list.isPending} error={list.error} empty={list.items.length === 0} emptyText="활성 예외가 없습니다." onRetry={() => void list.refetch()}>
        <ul className="mt-3 space-y-2">
          {list.items.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f5f7fb] p-4 text-sm">
              <div className="min-w-0">
                <p><span className="font-semibold">{o.item.name}</span> <span className="font-mono text-[13px]">{o.ruleId}</span></p>
                <p className="text-ink-3">{o.reason}</p>
              </div>
              <GhostButton disabled={readOnly || revoke.isPending} onClick={() => revoke.mutate(o.id)}>철회</GhostButton>
            </li>
          ))}
        </ul>
        <MutationError error={revoke.error} />
      </QueryState>
      <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-2" aria-label="Override 생성">
        <label className="text-xs text-muted">항목 ID<input name="itemId" inputMode="numeric" required className={field} /></label>
        <label className="text-xs text-muted">fingerprint (64 hex)<input name="fingerprint" required className={`${field} font-mono`} /></label>
        <label className="text-xs text-muted sm:col-span-2">사유 (10자 이상)<input name="reason" required maxLength={500} className={field} /></label>
        <label className="text-xs text-muted sm:col-span-2">이의 제기 URL (선택, github.com)<input name="appealUrl" className={field} /></label>
        <div className="sm:col-span-2">
          <PrimaryButton type="submit" disabled={readOnly || create.isPending}>예외 등록</PrimaryButton>
          {errors && <p role="alert" className="mt-2 text-sm text-danger">{errors}</p>}
          <MutationError error={create.error} />
        </div>
      </form>
    </Bevel>
  );
}

export function Admin() {
  const user = useAuth((s) => s.user);
  const readOnly = READ_ONLY_ENV && isDemoUser(user);
  return (
    <section aria-labelledby="ad-h" className="mx-auto max-w-[1240px] px-4 pb-24 pt-12 sm:px-6">
      <h1 id="ad-h" className="text-[30px] font-bold tracking-[-0.035em] sm:text-4xl">관리자 콘솔</h1>
      {readOnly && (
        <p role="status" className="mt-4 rounded-2xl bg-accent/8 px-5 py-3 text-sm text-ink-2 shadow-[inset_0_0_0_1px_rgba(51,85,214,0.2)]">
          데모 관리자 계정은 읽기 전용입니다. 조회는 모두 가능하고, 실행·처리·예외 변경 버튼은 비활성화되어 있어요.
        </p>
      )}
      <div className="mt-6 space-y-5">
        <Runs readOnly={readOnly} />
        <Quality readOnly={readOnly} />
        <Overrides readOnly={readOnly} />
      </div>
    </section>
  );
}
