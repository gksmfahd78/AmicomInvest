import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyNews,
  groupNews,
  similarNews,
  newsCandleContext,
  newsDay,
} from "../src/newsAnalysis";
import type { StockNewsArticle } from "../src/newsTypes";
const article = (
  title: string,
  id = "a",
  publishedAt = "2026-09-09T02:00:00Z",
): StockNewsArticle => ({
  title,
  url: "https://www.mk.co.kr/news/stock/" + id,
  source: "매일경제",
  publishedAt,
});
test("뉴스 유형은 제목의 근거 표현을 반환하며 중복 유형과 기타를 구분한다", () => {
  assert.deepEqual(classifyNews("삼성전자 영업이익 개선, 자사주 매입"), [
    { category: "earnings", evidence: "영업이익" },
    { category: "shareholder", evidence: "자사주" },
  ]);
  assert.deepEqual(classifyNews("삼성전자 오늘 소식"), [
    { category: "other", evidence: "" },
  ]);
  assert.deepEqual(
    classifyNews("삼성전자 신주인수권 발행").map((t) => t.category),
    ["financing"],
  );
});
test("같은 이슈의 유사 제목만 묶고 출처와 원문을 모두 보존한다", () => {
  const a = article("[속보] 삼성전자 3분기 영업이익 10조원 기록", "a");
  const b = {
    ...article(
      "삼성전자, 3분기 영업이익 10조 기록",
      "b",
      "2026-09-09T03:00:00Z",
    ),
    source: "한국경제" as const,
  };
  assert.equal(similarNews(a, b, "삼성전자"), true);
  const groups = groupNews(
    [b, a, a, article("삼성전자 신제품 공개", "c")],
    "삼성전자",
  );
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].articles, [b, a]);
  assert.equal(groups[0].lead, b);
  assert.deepEqual(
    groupNews([a, b], "삼성전자"),
    groupNews([b, a], "삼성전자"),
  );
});
test("다른 수치·방향·부인·날짜와 회사명만 같은 기사는 분리한다", () => {
  const cases = [
    ["삼성전자 3분기 영업이익 10조 기록", "삼성전자 3분기 영업이익 12조 기록"],
    ["삼성전자 대규모 공급 계약 체결", "삼성전자 대규모 공급 계약 체결 부인"],
    ["삼성전자 영업이익 전망 상승", "삼성전자 영업이익 전망 하락"],
    ["삼성전자 3분기 영업이익 발표", "삼성전자 임직원 성과급 지급 발표"],
  ];
  cases.push([
    "삼성전자 대규모 공급 계약 체결",
    "삼성전자 대규모 공급 계약 체결 사실무근",
  ]);
  for (const [a, b] of cases)
    assert.equal(
      similarNews(article(a), article(b, "b"), "삼성전자"),
      false,
      a,
    );
  assert.equal(
    similarNews(
      article("삼성전자 신제품 공개"),
      article("삼성전자 신제품 공개", "b", "2026-09-06T02:00:00Z"),
      "삼성전자",
    ),
    false,
  );
});
test("KST 날짜와 정규장 시간 경계를 사용하며 휴장일은 다른 일봉에 연결하지 않는다", () => {
  const bars = [
    {
      date: "2026-09-08",
      open: 90,
      high: 110,
      low: 80,
      close: 100,
      volume: 100,
    },
    {
      date: "2026-09-09",
      open: 105,
      high: 115,
      low: 95,
      close: 110,
      volume: 150,
    },
  ];
  assert.equal(newsDay("2026-09-08T16:00:00Z"), "2026-09-09");
  for (const [at, session] of [
    ["2026-09-08T23:59:00Z", "장 시작 전"],
    ["2026-09-09T00:00:00Z", "장중"],
    ["2026-09-09T06:29:00Z", "장중"],
    ["2026-09-09T06:30:00Z", "장 마감 후"],
  ]) {
    const result = newsCandleContext(article("뉴스", "a", at), bars);
    assert.equal(result.day, "2026-09-09");
    assert.equal(result.session, session);
    assert.equal(result.index, 1);
    assert.ok(Math.abs(result.dayChange! - 10) < 1e-9);
  }
  const absent = newsCandleContext(
    article("뉴스", "a", "2026-09-12T02:00:00Z"),
    bars,
  );
  assert.equal(absent.bar, null);
  assert.equal(absent.index, -1);
  assert.equal(absent.dayChange, null);
  assert.equal(
    newsCandleContext(article("뉴스", "a", "2026-09-08T02:00:00Z"), bars)
      .dayChange,
    null,
  );
});
