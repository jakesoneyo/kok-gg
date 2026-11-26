// 검색 서버 워밍업 안내: Retry-After 초 뒤 자동 재시도하고 남은 시간을 보여 준다. 수동 재시도도 가능.
import { useEffect, useState } from "react";
import { retryAfterSeconds } from "../lib/errors";
import { GhostButton } from "./ui";

export function Warming({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const total = retryAfterSeconds(error);
  const [left, setLeft] = useState(total);
  // 부모가 새 오류마다 key 를 바꿔 다시 마운트하므로 카운트다운은 마운트 시점에서만 시작
  useEffect(() => {
    const t = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) onRetry();
  }, [left, onRetry]);
  return (
    <div role="status" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <p className="max-w-[48ch] text-ink-2">검색 서버를 깨우는 중입니다. 무료 서버라 처음에는 시간이 걸려요. {Math.max(left, 0)}초 뒤 자동으로 다시 시도합니다.</p>
      <GhostButton onClick={onRetry}>지금 다시 시도</GhostButton>
    </div>
  );
}
