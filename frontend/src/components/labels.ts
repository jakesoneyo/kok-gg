// 화면 표시용 한국어 라벨과 필터 옵션(종류·보안 등급·정렬). 컴포넌트 파일과 분리해 fast refresh를 유지.
import type { Kind, Level } from "../shared/schemas";

export const KIND_LABEL = { PLUGIN: "플러그인", SKILL: "스킬", HOOK: "훅" } as const;
export const LEVEL_LABEL = { SAFE: "안전", CAUTION: "주의", DANGER: "위험" } as const;
export const KIND_OPTIONS: { value: Kind | "ALL"; label: string }[] = [
  { value: "ALL", label: "전체" },
  ...(["PLUGIN", "SKILL", "HOOK"] as const).map((k) => ({ value: k, label: KIND_LABEL[k] })),
];
export const LEVEL_OPTIONS: { value: Level | "ALL"; label: string }[] = [
  { value: "ALL", label: "전체" },
  ...(["SAFE", "CAUTION", "DANGER"] as const).map((l) => ({ value: l, label: LEVEL_LABEL[l] })),
];
export const SORT_LABEL = { trending: "트렌딩", stars: "총 스타순", updated: "최근 업데이트순", new: "신규 등록순" } as const;
