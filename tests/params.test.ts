import { describe, it, expect } from "vitest";
import { parseParams, toQuery } from "@/lib/reports/params";

describe("report parameters", () => {
  it("defaults to every business, by property, for the given year", () => {
    const p = parseParams({}, 2024, "income-statement");
    expect(p).toMatchObject({ entity: "all", columns: "property", from: "2024-01-01", to: "2024-12-31", property: "all" });
  });

  it("reads a business filter and by-business columns", () => {
    const p = parseParams({ entity: "abc", columns: "entity" }, 2024, "net-cash-flow");
    expect(p.entity).toBe("abc");
    expect(p.columns).toBe("entity");
  });

  it("ignores unknown column groupings", () => {
    expect(parseParams({ columns: "nonsense" }, 2024, "income-statement").columns).toBe("property");
  });

  it("keeps the business filter in the query, and leaves it out when it is the default", () => {
    const base = parseParams({}, 2024, "income-statement");
    expect(new URLSearchParams(toQuery(base, false)).has("entity")).toBe(false);
    expect(new URLSearchParams(toQuery({ ...base, entity: "abc" }, false)).get("entity")).toBe("abc");
  });
});
