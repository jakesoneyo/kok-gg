// 로그인/회원가입. 로그인은 상단에 고정 문구의 원클릭 데모 버튼을 둔다. 입력은 Zod로 검증하고 서버 오류는 describeError로 표시.
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useLogin, useRegister } from "../api/auth";
import { DemoLogin } from "../components/DemoLogin";
import { Bevel, PrimaryButton } from "../components/ui";
import { describeError } from "../lib/errors";
import { loginInputSchema, registerInputSchema } from "../shared/schemas";

const field = "mt-1 min-h-11 w-full rounded-2xl bg-surface px-4 text-base shadow-hair";

function useAuthForm<T extends Record<string, string>>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } },
  mutate: (v: T, o: { onError: (e: unknown) => void }) => void,
) {
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = schema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setError(null);
    mutate(parsed.data, { onError: (err) => setError(describeError(err).message) });
  };
  return { error, submit };
}

export function Login() {
  const login = useLogin();
  const { error, submit } = useAuthForm(loginInputSchema, (v, o) => login.mutate(v, o));
  return (
    <section aria-labelledby="l-h" className="mx-auto max-w-[460px] px-4 pb-24 pt-12 sm:px-6">
      <h1 id="l-h" className="text-[30px] font-bold tracking-[-0.035em]">로그인</h1>
      <Bevel className="mt-6" inner="p-6">
        <DemoLogin />
      </Bevel>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        <label className="block text-sm text-ink-3">이메일<input name="email" autoComplete="username" className={field} /></label>
        <label className="block text-sm text-ink-3">비밀번호<input name="password" type="password" autoComplete="current-password" className={field} /></label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <PrimaryButton type="submit" disabled={login.isPending} className="w-full">로그인</PrimaryButton>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        계정이 없나요? <Link to="/register" className="inline-flex min-h-11 items-center text-accent underline underline-offset-3">회원가입</Link>
      </p>
    </section>
  );
}

export function Register() {
  const reg = useRegister();
  const { error, submit } = useAuthForm(registerInputSchema, (v, o) => reg.mutate(v, o));
  return (
    <section aria-labelledby="r-h" className="mx-auto max-w-[460px] px-4 pb-24 pt-12 sm:px-6">
      <h1 id="r-h" className="text-[30px] font-bold tracking-[-0.035em]">회원가입</h1>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <label className="block text-sm text-ink-3">이름<input name="name" autoComplete="name" maxLength={40} className={field} /></label>
        <label className="block text-sm text-ink-3">이메일<input name="email" type="email" autoComplete="email" className={field} /></label>
        <label className="block text-sm text-ink-3">비밀번호 (8자 이상)<input name="password" type="password" autoComplete="new-password" className={field} /></label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <PrimaryButton type="submit" disabled={reg.isPending} className="w-full">가입하기</PrimaryButton>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        이미 계정이 있나요? <Link to="/login" className="inline-flex min-h-11 items-center text-accent underline underline-offset-3">로그인</Link>
      </p>
    </section>
  );
}
