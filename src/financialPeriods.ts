import type { FinancialRow } from "./financialTypes";

export type FinancialView = "annual" | "quarter" | "single" | "ttm";
export const incomeFields = [
  "revenue",
  "costOfSales",
  "grossProfit",
  "operatingProfit",
  "netIncome",
] as const;
export function shiftQuarter(date: string, offset: number) {
  const value = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4)) - 1 + offset * 3,
      1,
    ),
  );
  return (
    String(value.getUTCFullYear()) +
    String(value.getUTCMonth() + 1).padStart(2, "0")
  );
}

// KIS does not identify CFS/OFS. These are explicitly labelled estimates from
// the provider's cumulative series, not verified single-quarter statements.
export function derivePeriods(
  rows: FinancialRow[],
  mode: "single" | "ttm",
  fiscalMonth: number | null,
): FinancialRow[] {
  if (fiscalMonth !== 12) return [];
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const singles = rows
    .filter((row) => /^(19|20)\d{2}(03|06|09|12)$/.test(row.date))
    .map((row) => {
      const prior = byDate.get(shiftQuarter(row.date, -1));
      const result = { ...row, roe: null, eps: null };
      for (const key of incomeFields) {
        result[key] = row.date.endsWith("03")
          ? row[key]
          : row[key] !== null && prior?.[key] != null
            ? row[key]! - prior[key]!
            : null;
      }
      return result;
    });
  if (mode === "single") return singles;
  const quarters = new Map(singles.map((row) => [row.date, row]));
  return singles.map((row) => {
    const result = { ...row };
    const window = [0, -1, -2, -3].map((offset) =>
      quarters.get(shiftQuarter(row.date, offset)),
    );
    for (const key of incomeFields)
      result[key] = window.every((item) => item?.[key] != null)
        ? window.reduce((sum, item) => sum + item![key]!, 0)
        : null;
    return result;
  });
}
