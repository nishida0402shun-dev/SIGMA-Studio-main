import { describe, expect, it } from "vitest";

import { isCsvSource, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses quoted cells, escaped quotes, and embedded newlines", () => {
    const table = parseCsv('名前,メモ\r\n"山田, 太郎","1行目\n2行目"\r\n"引用""符",\r\n');
    expect(table).toEqual({
      rows: [
        ["名前", "メモ"],
        ["山田, 太郎", "1行目\n2行目"],
        ['引用"符', ""],
      ],
      truncated: false,
    });
  });

  it("keeps an empty trailing field but not a trailing blank row", () => {
    expect(parseCsv("a,b,\n1,2,\n").rows).toEqual([
      ["a", "b", ""],
      ["1", "2", ""],
    ]);
  });

  it("caps rows and columns for defensive display", () => {
    const table = parseCsv("a,b,c\n1,2,3\n4,5,6", { maxRows: 2, maxColumns: 2 });
    expect(table.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(table.truncated).toBe(true);
  });

  it("reports an unterminated quoted cell instead of hanging", () => {
    const table = parseCsv('a,"unterminated');
    expect(table.rows).toEqual([["a", "unterminated"]]);
    expect(table.truncated).toBe(true);
  });

  it("detects only CSV text sources", () => {
    expect(isCsvSource({ name: "data.CSV", format: "text" })).toBe(true);
    expect(isCsvSource({ name: "data.csv", format: "pdf" })).toBe(false);
    expect(isCsvSource({ name: "data.txt", format: "text" })).toBe(false);
  });
});
