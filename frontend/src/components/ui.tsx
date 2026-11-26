// 시안 D 공용 프리미티브: 이중 베젤 카드, 세그먼트/칩, 등급 배지, 로딩·빈·오류 상태 박스.
import { AlertTriangle, ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { describeError } from "../lib/errors";
import type { Level } from "../shared/schemas";
import { KIND_LABEL } from "./labels";

/** 이중 베젤: 바깥 틴트 래퍼 + 안쪽 흰 카드. */
export function Bevel({ children, className = "", inner = "p-7" }: { children: ReactNode; className?: string; inner?: string }) {
  return (
    <div className={`rounded-[30px] bg-white/50 p-1.5 shadow-[inset_0_0_0_1px_rgba(30,45,90,0.06)] ${className}`}>
      <div className={`rounded-[24px] bg-surface shadow-card ${inner}`}>{children}</div>
    </div>
  );
}

/** 선택 가능한 필 칩(정렬 등). aria-pressed 로 상태 전달. */
export function ChipButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-11 cursor-pointer rounded-full px-4 text-[13px] ${
        pressed
          ? "bg-accent/8 font-semibold text-accent shadow-[inset_0_0_0_1px_rgba(51,85,214,0.2)]"
          : "bg-surface text-ink-2 shadow-hair hover:shadow-card"
      }`}
    >
      {children}
    </button>
  );
}

/** 트랙 위 세그먼트 컨트롤(기간·종류·등급 필터). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "sm",
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "lg";
}) {
  const track = size === "lg" ? "p-1" : "p-[3px]";
  const btn = size === "lg" ? "min-w-[72px] px-[18px] text-sm" : "px-3.5 text-[13px]";
  return (
    <div role="group" aria-label={label} className={`inline-flex flex-wrap gap-0.5 rounded-full bg-track ${track}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`min-h-11 cursor-pointer rounded-full ${btn} ${
              on ? "bg-surface font-bold text-ink shadow-[0_1px_2px_rgba(20,30,60,0.08),0_4px_12px_-4px_rgba(20,30,60,0.14)]" : "text-ink-3 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 등급 배지: 색 + 아이콘 모양 + 텍스트 + 명도 차이(안전=연함, 주의=중간, 위험=진함)로 구분. */
export function LevelBadge({ level, unavailable = false, size = "md" }: { level: Level | null; unavailable?: boolean; size?: "md" | "lg" }) {
  const h = size === "lg" ? "h-[34px] px-3.5 text-sm" : "h-7 px-2.5 text-xs";
  const base = `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ${h}`;
  if (level === "SAFE")
    return (
      <span className={`${base} bg-safe text-safe-ink shadow-[inset_0_0_0_1px_var(--color-safe-line)]`}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        안전
      </span>
    );
  if (level === "CAUTION")
    return (
      <span className={`${base} bg-caution text-caution-ink`}>
        <svg width="11" height="10" viewBox="0 0 11 10" aria-hidden="true"><path d="M5.5 1 L10 9 H1 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        주의
      </span>
    );
  if (level === "DANGER")
    return (
      <span className={`${base} bg-danger font-bold text-white`}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.2" y="1.2" width="7.6" height="7.6" rx="1" fill="currentColor" /></svg>
        위험
      </span>
    );
  return <span className={`${base} bg-chip font-medium text-ink-3`}>{unavailable ? "분석 불가" : "미분석"}</span>;
}

export function KindTag({ kind }: { kind: keyof typeof KIND_LABEL }) {
  return <span className="inline-flex h-[26px] items-center rounded-full bg-[#f0f2f8] px-2.5 text-xs font-medium text-[#3d4763]">{KIND_LABEL[kind]}</span>;
}

/** 아이콘이 붙은 외부 링크 필(시안의 둥근 화살표 CTA). */
export function PillLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-11 items-center gap-2.5 rounded-full bg-surface pl-[18px] pr-1.5 text-sm font-medium shadow-hair hover:shadow-card ${className}`}
    >
      {children}
      <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded-full bg-chip">
        <ArrowUpRight size={14} />
      </span>
    </a>
  );
}

export function Loading({ label = "불러오는 중" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-12 text-muted motion-safe:animate-pulse">
      <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-12 text-center text-muted">{children}</p>;
}

/** 쿼리 오류 박스. 재시도 버튼은 refetch 가 있을 때만. */
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const info = describeError(error);
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <AlertTriangle size={20} className="text-danger" aria-hidden="true" />
      <p className="max-w-[48ch] text-ink-2">{info.message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-surface px-4 font-medium shadow-hair hover:shadow-card">
          <RefreshCw size={14} aria-hidden="true" />
          다시 시도
        </button>
      )}
    </div>
  );
}

/** 한 화면의 쿼리 상태 3분기(로딩/오류/빈)를 한 곳에서 처리. */
export function QueryState({
  isPending,
  error,
  empty,
  emptyText,
  onRetry,
  children,
}: {
  isPending: boolean;
  error: unknown;
  empty?: boolean;
  emptyText?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (isPending) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={onRetry} />;
  if (empty) return <Empty>{emptyText ?? "표시할 항목이 없습니다."}</Empty>;
  return <>{children}</>;
}

export function PrimaryButton({ children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgba(18,26,47,0.6)] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-surface px-4 text-sm font-medium shadow-hair hover:shadow-card disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}
