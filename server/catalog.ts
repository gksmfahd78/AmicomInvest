import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  existsSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { unzipSync } from "fflate";
import { z } from "zod";
import type { Stock } from "../src/types";
const path = resolve("data/stock-master.json");
const schema = z.object({
  updatedAt: z.string().datetime(),
  stocks: z.array(
    z.object({
      symbol: z.string().regex(/^[0-9A-Z]{6}$/),
      name: z.string().min(1),
      market: z.enum(["KOSPI", "KOSDAQ"]),
      sector: z.string(),
      base: z.number().positive(),
    }),
  ),
});
export function readCatalog() {
  try {
    if (existsSync(path))
      return schema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    console.warn("종목 캐시를 읽지 못했습니다. 기존 목록으로 실행합니다.");
  }
  return null;
}
export function parseMaster(
  bytes: Uint8Array,
  market: "KOSPI" | "KOSDAQ",
): Stock[] {
  const tail = market === "KOSPI" ? 227 : 221;
  const groups: Record<string, string> = {
    ST: "주식",
    FS: "외국주식",
    DR: "주식예탁증서",
    RT: "리츠",
    MF: "투자회사",
    SC: "선박투자회사",
    IF: "인프라펀드",
  };
  const result: Stock[] = [];
  for (const row of new TextDecoder("euc-kr", { fatal: true })
    .decode(bytes)
    .split(/\r?\n/)
    .filter(Boolean)) {
    const symbol = row.slice(0, 9).trim(),
      name = row.slice(21, -tail).trim(),
      group = row.slice(-tail, -tail + 2);
    if (!/^[0-9A-Z]{6}$/.test(symbol) || !groups[group]) continue;
    if (!name || name.includes("\ufffd"))
      throw Error("종목 파일의 이름 형식이 올바르지 않습니다.");
    result.push({ symbol, name, market, sector: groups[group], base: 10000 });
  }
  return result;
}
export async function downloadCatalog() {
  const lists = await Promise.all(
    (["KOSPI", "KOSDAQ"] as const).map(async (market) => {
      const name = market.toLowerCase() + "_code.mst";
      const response = await fetch(
        "https://new.real.download.dws.co.kr/common/master/" + name + ".zip",
        { signal: AbortSignal.timeout(20000) },
      );
      if (!response.ok) throw Error("종목 파일 다운로드 실패: " + market);
      const zipped = new Uint8Array(await response.arrayBuffer());
      if (zipped.length > 10000000) throw Error("종목 압축 파일 크기 초과");
      const file = unzipSync(zipped)[name];
      if (!file) throw Error("종목 파일 누락");
      const list = parseMaster(file, market);
      if (list.length < 500) throw Error("종목 목록이 불완전합니다: " + market);
      return list;
    }),
  );
  const stocks = lists.flat();
  if (new Set(stocks.map((s) => s.symbol)).size !== stocks.length)
    throw Error("종목코드 중복");
  const catalog = schema.parse({
    updatedAt: new Date().toISOString(),
    stocks: stocks.sort((a, b) => a.name.localeCompare(b.name, "ko")),
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + ".tmp", JSON.stringify(catalog));
  renameSync(path + ".tmp", path);
  return catalog;
}
