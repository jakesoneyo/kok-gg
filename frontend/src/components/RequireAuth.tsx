// 로그인(또는 관리자) 필요 화면 가드. 서버 가드가 진짜 방어이고, 이건 UX 용 리다이렉트.
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../store/auth";
import { Empty } from "./ui";

export function RequireAuth({ admin = false, children }: { admin?: boolean; children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (admin && user.role !== "ADMIN") return <Empty>관리자만 볼 수 있는 화면입니다.</Empty>;
  return <>{children}</>;
}
