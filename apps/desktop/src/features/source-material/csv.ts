/**
 * Small, dependency-free CSV reader for the source viewer.
 *
 * Extracted source text is UTF-8 and comes from Core. We only need to turn it
 * into table cells for display; the original bytes remain the canonical source
 * object. Parse defensively so a malformed or enormous table cannot lock up the
 * renderer.
 */

export interface CsvTable {
  rows: string[][];
  /** True when row/column limits or malformed quoting cut the display short. */
  truncated: boolean;
}

export interface CsvParseOptions {
  maxRows?: number;
  maxColumns?: number;
  maxCellCharacters?: number;
}

const DEFAULT_MAX_ROWS = 500;
const DEFAULT_MAX_COLUMNS = 60;
const DEFAULT_MAX_CELL_CHARACTERS = 20_000;

export function isCsvSource(source: { name: string; format: string }): boolean {
  return source.format === "text" && /\.csv$/iu.test(source.name);
}

function pushCell(
  row: string[],
  cell: string,
  maxColumns: number,
  state: { truncated: boolean },
): void {
  if (row.length >= maxColumns) {
    state.truncated = true;
    return;
  }
  row.push(cell);
}

function finishRow(
  rows: string[][],
  row: string[],
  maxRows: number,
  state: { truncated: boolean },
): string[] {
  if (rows.length >= maxRows) {
    state.truncated = true;
    return [];
  }
  rows.push(row);
  return [];
}

export function parseCsv(text: string, options: CsvParseOptions = {}): CsvTable {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const maxCellCharacters = options.maxCellCharacters ?? DEFAULT_MAX_CELL_CHARACTERS;
  const state = { truncated: false };
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let cellTruncated = false;

  const append = (value: string): void => {
    const remaining = maxCellCharacters - cell.length;
    if (remaining <= 0) {
      cellTruncated = true;
      return;
    }
    cell += value.slice(0, remaining);
    if (value.length > remaining) cellTruncated = true;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          append('"');
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        append(character);
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      inQuotes = true;
      continue;
    }
    if (character === ",") {
      pushCell(row, cell, maxColumns, state);
      cell = "";
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      pushCell(row, cell, maxColumns, state);
      cell = "";
      row = finishRow(rows, row, maxRows, state);
      if (rows.length >= maxRows) break;
      continue;
    }
    append(character);
  }

  if (rows.length < maxRows) {
    if (cell.length > 0 || cellTruncated || row.length > 0) {
      pushCell(row, cell, maxColumns, state);
      finishRow(rows, row, maxRows, state);
    }
  } else if (cell.length > 0 || row.length > 0) {
    state.truncated = true;
  }

  if (inQuotes) state.truncated = true;
  if (cellTruncated) state.truncated = true;
  return { rows, truncated: state.truncated };
}
