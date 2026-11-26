// 북마크 토글. 비로그인이면 로그인 화면으로 보내고, 로그인 상태면 PUT/DELETE 후 ids 캐시를 갱신.
import { Bookmark } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useBookmarkIds, useToggleBookmark } from "../api/queries";
import { useAuth } from "../store/auth";

export function BookmarkButton({ itemId, label, withText = false }: { itemId: number; label: string; withText?: boolean }) {
  const user = useAuth((s) => s.user);
  const ids = useBookmarkIds();
  const toggle = useToggleBookmark();
  const nav = useNavigate();
  const loc = useLocation();
  const on = ids.data?.has(itemId) ?? false;

  const click = () => {
    if (!user) return nav("/login", { state: { from: loc.pathname + loc.search } });
    toggle.mutate({ itemId, on: !on });
  };
  return (
    <button
      type="button"
      aria-label={`${label} ${on ? "북마크 해제" : "북마크 추가"}`}
      aria-pressed={on}
      disabled={toggle.isPending}
      onClick={click}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[14px] shadow-hair disabled:opacity-60 ${
        withText ? "rounded-full bg-surface px-[18px] text-sm font-medium" : "w-11"
      } ${on ? "bg-accent/10 text-accent" : "bg-surface text-ink-3"}`}
    >
      <Bookmark size={17} fill={on ? "currentColor" : "none"} aria-hidden="true" />
      {withText && "북마크"}
    </button>
  );
}
