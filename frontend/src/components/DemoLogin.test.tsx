import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useAuth } from "../store/auth";
import { fakeServer, renderApp } from "../test/render";
import { Login } from "../pages/Auth";

const session = { user: { id: 1, email: "admin", name: "admin", role: "ADMIN" }, accessToken: "a", refreshToken: "r" };

function renderLogin() {
  return renderApp(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<p>홈 화면</p>} />
    </Routes>,
    "/login",
  );
}

describe("데모 로그인", () => {
  it("고정 문구의 버튼과 보조 설명이 로그인 화면 상단에 노출", () => {
    fakeServer(() => ({}));
    renderLogin();
    expect(screen.getByRole("button", { name: "회원가입 없이 둘러보기" })).toBeInTheDocument();
    expect(screen.getByText("회원가입 없이 체험해 볼 수 있습니다.")).toBeInTheDocument();
  });

  it("원클릭으로 정상 로그인 엔드포인트에 admin/admin 을 보내고 세션 저장 후 이동", async () => {
    const calls = fakeServer(() => ({ status: 200, data: session }));
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: "회원가입 없이 둘러보기" }));
    await screen.findByText("홈 화면");
    expect(calls).toEqual([{ method: "post", url: "/auth/login", body: { email: "admin", password: "admin" } }]);
    expect(useAuth.getState().user?.email).toBe("admin");
  });

  it("429 이면 요청 과다 안내를 보여 주고 세션은 만들지 않음", async () => {
    fakeServer(() => ({ status: 429, data: { code: "RATE_LIMITED" }, headers: { "retry-after": "40" } }));
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: "회원가입 없이 둘러보기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("40초");
    expect(useAuth.getState().user).toBeNull();
  });

  it("일반 로그인 폼은 admin 외 비이메일을 클라이언트에서도 거부", async () => {
    const calls = fakeServer(() => ({ status: 200, data: session }));
    renderLogin();
    await userEvent.type(screen.getByLabelText("이메일"), "root");
    await userEvent.type(screen.getByLabelText("비밀번호"), "x");
    await userEvent.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("이메일 형식"));
    expect(calls).toHaveLength(0);
  });
});
