// 인증 상태(Zustand, localStorage 영속). 토큰 회전은 api 인터셉터가 setTokens 로 갱신한다.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "../shared/schemas";

type AuthState = {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (s: { user: User; accessToken: string; refreshToken: string }) => void;
  setTokens: (t: { accessToken: string; refreshToken: string }) => void;
  clear: () => void;
};

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setSession: (s) => set(s),
      setTokens: (t) => set(t),
      clear: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    { name: "kokgg-auth" },
  ),
);

/** 데모 계정은 email 이 'admin' 리터럴(API.md 2장). 서버 가드가 진짜 방어고 이건 버튼 비활성 힌트. */
export const isDemoUser = (u: User | null) => u?.email === "admin";
