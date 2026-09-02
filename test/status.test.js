// data/status.json is small, but it is the write path for the one state change
// that happens exactly once and can never be corrected by the next run — get it
// wrong and there is no "tomorrow's snapshot" to quietly fix it.

import { describe, it, expect } from "vitest";

import { parseStatus } from "../lib/status.js";

describe("parseStatus", () => {
  it("accepts a well-formed status", () => {
    expect(parseStatus('{"shippedDate":"2026-09-02"}')).toEqual({ shippedDate: "2026-09-02" });
  });

  it("throws on malformed JSON", () => {
    expect(() => parseStatus('{"shippedDate":')).toThrow(/not valid JSON/);
  });

  it("throws when the file is not an object", () => {
    expect(() => parseStatus("[]")).toThrow(/must be an object/);
    expect(() => parseStatus("null")).toThrow(/must be an object/);
    expect(() => parseStatus('"2026-09-02"')).toThrow(/must be an object/);
  });

  it("throws on a missing or malformed shippedDate", () => {
    expect(() => parseStatus("{}")).toThrow(/bad shippedDate/);
    expect(() => parseStatus('{"shippedDate":"02/09/2026"}')).toThrow(/bad shippedDate/);
  });
});
