// pre-commit: 포맷(전 파일) + 영향받은 앱만 타입체크 + Python은 ruff.
// 전체 테스트는 훅에서 돌리지 않고 CI가 담당(훅을 빠르게 유지).
export default {
  "*": "prettier --ignore-unknown --write",
  // 함수형 명령 = 파일 목록을 인자로 넘기지 않는다(tsc는 프로젝트 단위로 검사)
  "backend/**/*.ts": () => "npm --prefix backend run typecheck",
  "frontend/**/*.{ts,tsx}": () => "npm --prefix frontend run typecheck",
  "ai/**/*.py": ["uvx ruff check --fix", "uvx ruff format"],
};
