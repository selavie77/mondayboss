import { describe, it, expect } from "vitest";
import { bpToPercent, ownershipProblem, percentToBp } from "@/lib/ownership";

describe("ownership percentages", () => {
  it("reads what people type", () => {
    expect(percentToBp("60")).toBe(6000);
    expect(percentToBp(" 33.33 ")).toBe(3333);
    expect(percentToBp("12.5%")).toBe(1250);
    expect(percentToBp("100")).toBe(10000);
  });

  it("rejects what is not a share", () => {
    for (const bad of ["", "abc", "0", "-5", "101", "33.333", "1e2", "60 40"]) expect(percentToBp(bad)).toBeNull();
  });

  it("shows basis points without trailing zeros", () => {
    expect(bpToPercent(6000)).toBe("60");
    expect(bpToPercent(3333)).toBe("33.33");
    expect(bpToPercent(1250)).toBe("12.5");
    expect(bpToPercent(10000)).toBe("100");
  });

  it("accepts owners that add up to 100% with the books-keeper among them", () => {
    expect(ownershipProblem([{ entityId: "a", percentBp: 6000 }, { entityId: "b", percentBp: 4000 }], "a")).toBeNull();
    expect(ownershipProblem([{ entityId: "a", percentBp: 10000 }], "a")).toBeNull();
  });

  it("says what is wrong otherwise", () => {
    expect(ownershipProblem([], "a")).toMatch(/at least one/);
    expect(ownershipProblem([{ entityId: "a", percentBp: 6000 }, { entityId: "b", percentBp: 3000 }], "a")).toMatch(/add up to 90%/);
    expect(ownershipProblem([{ entityId: "a", percentBp: 5000 }, { entityId: "a", percentBp: 5000 }], "a")).toMatch(/only once/);
    expect(ownershipProblem([{ entityId: "a", percentBp: 10000 }], "z")).toMatch(/keeps the books/);
  });
});
