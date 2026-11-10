// Sample-data parsing, classing and number formatting. Pure functions, no DOM.

export type Row = Readonly<Record<string, string>>;

/** Splits one CSV line, honouring double-quoted cells. */
const splitLine = (line: string): readonly string[] => {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted && char === '"' && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  return [...cells, cell];
};

export const parseCsv = (text: string): readonly Row[] => {
  const [headerLine = "", ...lines] = text.trim().split(/\r?\n/);
  const header = splitLine(headerLine);
  return lines.map((line) => {
    const cells = splitLine(line);
    return Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""]));
  });
};

/** Upper bounds that split the values into equal-sized classes (quantiles). */
export const classBreaks = (values: readonly number[], classes: number): readonly number[] => {
  const sorted = values.toSorted((a, b) => a - b);
  return Array.from({ length: classes - 1 }, (_, index) => {
    const position = Math.floor(((index + 1) * sorted.length) / classes);
    return sorted[Math.min(position, sorted.length - 1)] ?? 0;
  });
};

/** Index of the class a value falls in: 0 is the lowest. */
export const classOf = (value: number, breaks: readonly number[]): number => {
  const index = breaks.findIndex((upper) => value < upper);
  return index === -1 ? breaks.length : index;
};

export const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

export const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : sum(values) / values.length;

export const formatNumber = (value: number, digits: number): string =>
  value.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
