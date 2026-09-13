import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zipSync } from "fflate";
import { parseThemeMaster, ThemeCatalogStore } from "./themes";
import {
  indexStockThemes,
  matchesStockSearch,
  matchesStockTheme,
} from "../src/stockFilters";
import type { Stock } from "../src/types";

function row(code: string, name: Buffer | string, symbol: string) {
  const line = Buffer.alloc(52, " ");
  line.write(code, 0, "ascii");
  Buffer.from(name).copy(line, 3);
  line.write(symbol, 43, "ascii");
  return line;
}
const semiconductor = Buffer.from("b9ddb5b5c3bc", "hex");
const master = Buffer.concat([
  row("004", semiconductor, "005930"),
  Buffer.from("\r\n"),
  row("004", semiconductor, "000660"),
  Buffer.from("\n"),
  row("004", semiconductor, "005930"),
  Buffer.from("\n"),
  row("231", "HBM", "005930"),
]);
function response(bytes = master) {
  const zipped = zipSync({ "theme_code.mst": bytes });
  return new Response(Buffer.from(zipped));
}

test("테마 마스터: CP949·줄바꿈·중복 제거·종목별 다중 테마", () => {
  const themes = parseThemeMaster(master);
  assert.equal(themes.length, 2);
  assert.deepEqual(
    themes.find((t) => t.code === "004"),
    { code: "004", name: "반도체", symbols: ["000660", "005930"] },
  );
  assert.equal(indexStockThemes(themes).get("005930")?.length, 2);
  assert.throws(() => parseThemeMaster(new Uint8Array()));
  assert.throws(() => parseThemeMaster(master.subarray(0, 30)));
  assert.throws(() => parseThemeMaster(row("bad", "Invalid", "005930")));
  assert.throws(() =>
    parseThemeMaster(
      Buffer.concat([
        row("004", "One", "005930"),
        Buffer.from("\n"),
        row("004", "Two", "000660"),
      ]),
    ),
  );
});

test("테마 캐시: 동시 요청 공유·재시작 복원·갱신 실패 시 기존 분류 보존", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amicom-themes-"));
  try {
    let now = Date.parse("2026-09-09T00:00:00Z"),
      calls = 0,
      offline = false;
    const fetcher: typeof fetch = async () => {
      calls++;
      if (offline) throw Error("offline");
      return response();
    };
    const path = join(dir, "themes.json");
    const store = new ThemeCatalogStore(path, fetcher, () => now);
    const [first, second] = await Promise.all([store.get(), store.get()]);
    assert.deepEqual(first, second);
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), first);
    offline = true;
    now += 86400001;
    assert.deepEqual(await store.refresh(), first);
    assert.deepEqual(await store.get(), first);
    assert.equal(calls, 2);
    const restored = new ThemeCatalogStore(path, fetcher, () => now);
    assert.deepEqual(await restored.get(), first);
    await restored.refresh();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("테마 캐시: 초기 실패 재시도 간격과 복구", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amicom-themes-retry-"));
  try {
    let now = 0,
      calls = 0;
    const store = new ThemeCatalogStore(
      join(dir, "themes.json"),
      async () => {
        calls++;
        if (calls === 1) return new Response("unavailable", { status: 503 });
        return response();
      },
      () => now,
    );
    await assert.rejects(store.get());
    await assert.rejects(store.get());
    assert.equal(calls, 1);
    now = 60001;
    assert.equal((await store.get()).themes.length, 2);
    assert.equal(calls, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("종목 검색: 테마명·종목명 조합, 코드, 다중 테마, 미분류", () => {
  const stock: Stock = {
    symbol: "005930",
    name: "삼성전자",
    market: "KOSPI",
    sector: "주식",
    base: 10000,
  };
  const themes = indexStockThemes(parseThemeMaster(master)).get(stock.symbol)!;
  assert.equal(matchesStockSearch(stock, themes, "반도체 삼성"), true);
  assert.equal(matchesStockSearch(stock, themes, "hbm"), true);
  assert.equal(matchesStockSearch(stock, themes, "００５９３０"), true);
  assert.equal(matchesStockSearch(stock, themes, "자동차"), false);
  assert.equal(matchesStockTheme(themes, "004"), true);
  assert.equal(matchesStockTheme(themes, "231"), true);
  assert.equal(matchesStockTheme(themes, "UNCLASSIFIED"), false);
  assert.equal(matchesStockTheme([], "UNCLASSIFIED"), true);
  assert.equal(matchesStockTheme([], "ALL"), true);
});
