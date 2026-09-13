import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { unzipSync } from "fflate";
import { z } from "zod";
import type { StockTheme, StockThemeCatalog } from "../src/types";

export const THEME_SOURCE =
  "https://new.real.download.dws.co.kr/common/master/theme_code.mst.zip";
const DAY = 86400000;
const schema = z.object({
  updatedAt: z.string().datetime(),
  themes: z
    .array(
      z.object({
        code: z.string().regex(/^\d{3}$/),
        name: z.string().trim().min(1).max(40),
        symbols: z.array(z.string().regex(/^[A-Z0-9]{6}$/)).min(1),
      }),
    )
    .min(1),
});

// KIS master layout: 3-byte theme code, 40-byte CP949 name, 6-byte symbol, 3-byte filler.
// https://github.com/koreainvestment/open-trading-api/blob/main/stocks_info/theme_code.py
export function parseThemeMaster(bytes: Uint8Array): StockTheme[] {
  const themes = new Map<string, { name: string; symbols: Set<string> }>();
  const decoder = new TextDecoder("euc-kr", { fatal: true });
  let start = 0;
  for (let end = 0; end <= bytes.length; end++) {
    if (end < bytes.length && bytes[end] !== 10) continue;
    let row = bytes.subarray(start, end);
    start = end + 1;
    if (row.at(-1) === 13) row = row.subarray(0, -1);
    if (!row.length) continue;
    if (row.length !== 52)
      throw Error("테마 마스터의 행 길이가 올바르지 않습니다.");
    const code = decoder.decode(row.subarray(0, 3));
    const name = decoder.decode(row.subarray(3, 43)).trim();
    const symbol = decoder.decode(row.subarray(43, 49));
    if (!/^\d{3}$/.test(code) || !name || !/^[A-Z0-9]{6}$/.test(symbol))
      throw Error("테마 마스터에 잘못된 코드가 있습니다.");
    const theme = themes.get(code) ?? { name, symbols: new Set<string>() };
    if (theme.name !== name)
      throw Error("동일 테마코드의 이름이 일치하지 않습니다.");
    theme.symbols.add(symbol);
    themes.set(code, theme);
  }
  if (!themes.size) throw Error("테마 목록이 비어 있습니다.");
  return [...themes]
    .map(([code, theme]) => ({
      code,
      name: theme.name,
      symbols: [...theme.symbols].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export class ThemeCatalogStore {
  private catalog: StockThemeCatalog | null = null;
  private pending: Promise<StockThemeCatalog> | null = null;
  private lastAttempt = -Infinity;
  constructor(
    private readonly cachePath = resolve("data/stock-themes.json"),
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    try {
      this.catalog = schema.parse(JSON.parse(readFileSync(cachePath, "utf8")));
    } catch {
      /* Missing or invalid cache is rebuilt from the provider. */
    }
  }
  async get(): Promise<StockThemeCatalog> {
    if (this.catalog) {
      if (this.now() - Date.parse(this.catalog.updatedAt) >= DAY)
        void this.refresh().catch(() => {});
      return this.catalog;
    }
    return this.refresh();
  }
  refresh(): Promise<StockThemeCatalog> {
    if (this.pending) return this.pending;
    if (this.now() - this.lastAttempt < 60000) {
      return this.catalog
        ? Promise.resolve(this.catalog)
        : Promise.reject(Error("테마 분류를 잠시 후 다시 불러와 주세요."));
    }
    this.lastAttempt = this.now();
    this.pending = this.download()
      .catch((error) => {
        if (this.catalog) return this.catalog;
        throw error;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  private async download(): Promise<StockThemeCatalog> {
    const response = await this.fetcher(THEME_SOURCE, {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error("테마 분류를 불러오지 못했습니다.");
    const zip = new Uint8Array(await response.arrayBuffer());
    if (zip.length > 10000000) throw Error("테마 파일 크기가 너무 큽니다.");
    const file = unzipSync(zip, {
      filter: (entry) =>
        entry.name === "theme_code.mst" && entry.originalSize <= 10000000,
    })["theme_code.mst"];
    if (!file) throw Error("테마 마스터 파일이 없습니다.");
    const next = {
      updatedAt: new Date(this.now()).toISOString(),
      themes: parseThemeMaster(file),
    };
    // A truncated update must not replace a previously complete classification.
    if (this.catalog && next.themes.length < this.catalog.themes.length / 2)
      throw Error("테마 목록이 불완전합니다.");
    this.catalog = next;
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true });
      writeFileSync(this.cachePath + ".tmp", JSON.stringify(next));
      renameSync(this.cachePath + ".tmp", this.cachePath);
    } catch {
      console.warn("테마 캐시 저장 실패: 현재 메모리의 분류를 사용합니다.");
    }
    return next;
  }
}
