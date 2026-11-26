// 원클릭 데모 로그인. 고정 문구 + 정상 로그인 엔드포인트(admin/admin)를 그대로 호출한다(우회 경로 없음).
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { useLogin } from "../api/auth";
import { describeError } from "../lib/errors";

export function DemoLogin() {
  const login = useLogin();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={login.isPending}
        onClick={() => {
          setError(null);
          login.mutate({ email: "admin", password: "admin" }, { onError: (e) => setError(describeError(e).message) });
        }}
        className="inline-flex min-h-[52px] w-full cursor-pointer items-center justify-between gap-2.5 rounded-full bg-ink pl-5 pr-1.5 text-[15px] font-semibold text-white shadow-[0_10px_22px_-12px_rgba(18,26,47,0.7)] hover:bg-ink-2 disabled:opacity-60"
      >
        회원가입 없이 둘러보기
        <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-full bg-white/15">
          <ArrowUpRight size={15} />
        </span>
      </button>
      <p className="mt-2.5 text-center text-[13px] text-muted">회원가입 없이 체험해 볼 수 있습니다.</p>
      {error && (
        <p role="alert" className="mt-2 text-center text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
