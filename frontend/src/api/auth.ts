// 로그인·가입·로그아웃 뮤테이션. 성공 시 세션 저장 후 원래 가려던 곳(없으면 홈)으로 이동.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { send } from "../lib/api";
import { authResultSchema } from "../shared/schemas";
import { useAuth } from "../store/auth";

function useSessionMutation(path: "/auth/login" | "/auth/register") {
  const setSession = useAuth((s) => s.setSession);
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, string>) => send("post", path, authResultSchema, body),
    onSuccess: (r) => {
      setSession(r);
      void qc.invalidateQueries({ queryKey: ["bookmark-ids"] });
      nav((loc.state as { from?: string } | null)?.from ?? "/", { replace: true });
    },
  });
}
export const useLogin = () => useSessionMutation("/auth/login");
export const useRegister = () => useSessionMutation("/auth/register");

export function useLogout() {
  const nav = useNavigate();
  const qc = useQueryClient();
  return async () => {
    const { refreshToken, clear } = useAuth.getState();
    try {
      if (refreshToken) await send("post", "/auth/logout", null, { refreshToken });
    } catch {
      // 서버 폐기에 실패해도 클라이언트 세션은 지운다
    }
    clear();
    qc.clear();
    nav("/");
  };
}
