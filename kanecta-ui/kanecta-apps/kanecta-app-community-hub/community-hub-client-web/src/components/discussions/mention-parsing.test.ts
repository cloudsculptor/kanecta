import { vi, describe, it, expect } from "vitest";

// MentionInput pulls in the api layer, which imports the browser-only Keycloak
// singleton at module load. Stub it so the pure parsing helpers can be tested
// in a plain Node environment.
vi.mock("../../auth/keycloak", () => ({ default: { token: undefined } }));

import { parseContent, encodeMention } from "./MentionInput";

// How message content is split into text / @mention / URL segments drives how
// every discussion message renders. This is behaviour that must not change.

describe("parseContent", () => {
  it("returns a single text segment for plain content", () => {
    expect(parseContent("hello world")).toEqual([{ type: "text", value: "hello world" }]);
  });

  it("returns an empty array for empty content", () => {
    expect(parseContent("")).toEqual([]);
  });

  it("extracts a single encoded mention, exposing the display name (not the id)", () => {
    expect(parseContent("@[Jane Smith](user-1)")).toEqual([
      { type: "mention", value: "Jane Smith" },
    ]);
  });

  it("splits surrounding text around a mention", () => {
    expect(parseContent("hi @[Jane](u1)!")).toEqual([
      { type: "text", value: "hi " },
      { type: "mention", value: "Jane" },
      { type: "text", value: "!" },
    ]);
  });

  it("detects http/https URLs as their own segments", () => {
    expect(parseContent("see https://featherston.co.nz now")).toEqual([
      { type: "text", value: "see " },
      { type: "url", value: "https://featherston.co.nz" },
      { type: "text", value: " now" },
    ]);
  });

  it("handles a mention and a URL in the same message", () => {
    expect(parseContent("@[Mike](u2) posted https://x.co/p")).toEqual([
      { type: "mention", value: "Mike" },
      { type: "text", value: " posted " },
      { type: "url", value: "https://x.co/p" },
    ]);
  });

  it("parses multiple mentions", () => {
    const segs = parseContent("@[A](1) and @[B](2)");
    expect(segs.filter((s) => s.type === "mention").map((s) => s.value)).toEqual(["A", "B"]);
  });
});

describe("encodeMention", () => {
  it("encodes a user as @[name](id)", () => {
    expect(encodeMention({ id: "user-9", name: "Sam Green" })).toBe("@[Sam Green](user-9)");
  });

  it("round-trips through parseContent back to the display name", () => {
    const encoded = encodeMention({ id: "u7", name: "Aroha" });
    expect(parseContent(encoded)).toEqual([{ type: "mention", value: "Aroha" }]);
  });
});
