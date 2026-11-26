// 테스트 공통 설정: jest-dom 매처 등록, 테스트마다 DOM·스토리지 초기화.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { useAuth } from "../store/auth";

afterEach(() => {
  cleanup();
  localStorage.clear();
  useAuth.getState().clear();
});
