// 앱 셸: 떠 있는 필 헤더 + 콘텐츠 + 푸터. 인증 상태에 따라 로그인/로그아웃 버튼 전환.
import { ArrowUpRight, LogOut } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useLogout } from "../api/auth";
import { useAuth } from "../store/auth";
import { ColdStartBanner } from "./ColdStartBanner";

const NAV = [
  { to: "/", label: "트렌딩", end: true },
  { to: "/catalog", label: "카탈로그" },
  { to: "/search", label: "검색" },
  { to: "/bookmarks", label: "북마크" },
];

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span aria-hidden="true" className={`inline-flex items-center justify-center bg-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] ${small ? "size-6 rounded-lg" : "size-7 rounded-[9px]"}`}>
        <span className="size-2 rounded-full bg-white" />
      </span>
      <span className={`font-bold tracking-tight ${small ? "text-[17px]" : "text-[19px]"}`}>
        kok<span className="text-accent">.</span>gg
      </span>
    </span>
  );
}

function Header() {
  const user = useAuth((s) => s.user);
  const logout = useLogout();
  const link = "inline-flex min-h-11 items-center rounded-full px-4 text-sm";
  const nav = user?.role === "ADMIN" ? [...NAV, { to: "/admin", label: "관리자" }] : NAV;
  return (
    <header className="mx-auto max-w-[1240px] px-4 pt-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-7 gap-y-2 rounded-bevel bg-surface py-2 pl-[18px] pr-2 shadow-card">
        <Link to="/" aria-label="kok.gg 홈" className="inline-flex min-h-11 items-center gap-2.5">
          <Logo />
          <span className="text-[13px] text-muted">콕지지</span>
        </Link>
        <nav aria-label="주요 메뉴" className="flex-1">
          <ul className="flex flex-wrap gap-0.5">
            {nav.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} className={({ isActive }) => `${link} ${isActive ? "bg-chip font-semibold text-ink" : "text-ink-3 hover:text-ink"}`}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {user ? (
          <button type="button" onClick={logout} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-chip px-4 text-sm font-semibold">
            <LogOut size={14} aria-hidden="true" />
            로그아웃
          </button>
        ) : (
          <Link to="/login" className="inline-flex min-h-11 items-center gap-2.5 rounded-full bg-ink pl-[18px] pr-1.5 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgba(18,26,47,0.6)]">
            로그인
            <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded-full bg-white/15">
              <ArrowUpRight size={14} />
            </span>
          </Link>
        )}
      </div>
    </header>
  );
}

function Footer() {
  const l = "inline-flex min-h-11 items-center rounded-full bg-surface px-4 text-sm text-ink-2 shadow-hair";
  return (
    <footer className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-6 px-4 pb-12 pt-14 sm:px-6">
      <div className="min-w-0 flex-1 basis-80">
        <Logo small />
        <p className="mt-3 max-w-[52ch] text-[13px] leading-[1.7] text-muted">
          스타 이력은 GitHub API와 공식 스타 기록을 교차검증해 매일 갱신합니다. 위험 신호 탐지는 규칙 기반이며 안전을 보증하지 않습니다.
        </p>
      </div>
      <nav aria-label="데이터와 정책" className="flex flex-1 basis-96 flex-wrap content-start gap-1.5">
        <Link to="/methodology" className={l}>
          Trend Score·위험 신호 방법론
        </Link>
        <Link to="/methodology#rules" className={l}>
          위험 신호 규칙표
        </Link>
      </nav>
    </footer>
  );
}

export function Layout() {
  return (
    <div className="min-h-screen">
      <Header />
      <ColdStartBanner />
      <main>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
