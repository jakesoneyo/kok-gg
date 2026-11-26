import { describe, expect, it } from "vitest";
import { falsePositiveIssueUrl, permalink } from "./links";

describe("permalink", () => {
  it("repo.url/blob/{sha}/{path}#L{line}", () => {
    expect(permalink("https://github.com/a/b", "abc123", "hooks/x.sh", 12)).toBe(
      "https://github.com/a/b/blob/abc123/hooks/x.sh#L12",
    );
  });
  it("headSha 가 없으면 null", () => {
    expect(permalink("https://github.com/a/b", null, "x", 1)).toBeNull();
  });
});

describe("falsePositiveIssueUrl", () => {
  it("이슈 양식 필드 item_id·fingerprint 가 프리필됨", () => {
    const u = new URL(falsePositiveIssueUrl("o/r", { itemId: 812, itemName: "pre-pr", fingerprint: "abc" }));
    expect(u.origin + u.pathname).toBe("https://github.com/o/r/issues/new");
    expect(u.searchParams.get("template")).toBe("security-appeal.yml");
    expect(u.searchParams.get("item_id")).toBe("812");
    expect(u.searchParams.get("fingerprint")).toBe("abc");
    expect(u.searchParams.get("title")).toContain("pre-pr");
  });
  it("fingerprint 없이도 항목 id 만으로 열림", () => {
    const u = new URL(falsePositiveIssueUrl("o/r", { itemId: 1, itemName: "n" }));
    expect(u.searchParams.get("item_id")).toBe("1");
    expect(u.searchParams.has("fingerprint")).toBe(false);
  });
});
