import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseNewsFeed,
  matchesStockNews,
  newsUrl,
  StockNewsStore,
  NEWS_FEEDS,
} from "./news";
const mkFeeds = NEWS_FEEDS.filter((feed) => feed.source === "매일경제");
const now = Date.parse("2026-09-09T03:00:00Z");
const rss = (
  title = "삼성전자, 실적 개선",
  url = "https://www.mk.co.kr/news/stock/123",
  date = "Wed, 09 Sep 2026 11:00:00 +09:00",
) =>
  `<?xml version="1.0"?><rss><channel><title>매일경제</title><item><title><![CDATA[${title}]]></title><link><![CDATA[${url}]]></link><pubDate>${date}</pubDate><description>본문은 저장하지 않습니다</description></item></channel></rss>`;
const stock = { symbol: "005930", name: "삼성전자" };
test("RSS 파싱: CDATA·날짜·원문 URL 검증, 본문 제외", () => {
  const [article] = parseNewsFeed(rss(), now);
  assert.equal(article.title, "삼성전자, 실적 개선");
  assert.equal(article.publishedAt, "2026-09-09T02:00:00.000Z");
  assert.equal("description" in article, false);
  assert.equal(
    parseNewsFeed(rss("제목", "javascript:alert(1)"), now).length,
    0,
  );
  assert.equal(
    parseNewsFeed(
      rss("제목", "https://www.mk.co.kr.evil.test/news/stock/123"),
      now,
    ).length,
    0,
  );
  assert.equal(
    parseNewsFeed(rss("제목", undefined, "bad date"), now).length,
    0,
  );
  assert.equal(
    parseNewsFeed(
      rss("제목", undefined, "Wed, 01 Jan 2020 00:00:00 +09:00"),
      now,
    ).length,
    0,
  );
  assert.equal(
    newsUrl("https://www.mk.co.kr/news/stock/123?utm_source=test#test"),
    "https://www.mk.co.kr/news/stock/123",
  );
  assert.throws(() =>
    parseNewsFeed('<!DOCTYPE rss [<!ENTITY a "a">]>' + rss(), now),
  );
  assert.throws(() => parseNewsFeed("<html>Not RSS</html>", now));
  assert.throws(() => parseNewsFeed("<rss><channel>", now));
});
test("종목 연결: 한글 조사·공백·영문 별칭, 비슷한 이름과 짧은 일반어 제외", () => {
  assert.equal(matchesStockNews("삼성전자는 실적 개선", stock), true);
  assert.equal(matchesStockNews("삼성 전자, 실적 개선", stock), true);
  assert.equal(matchesStockNews("삼성전자우, 주가 상승", stock), false);
  assert.equal(
    matchesStockNews("삼성전자, 상승", { symbol: "009150", name: "삼성전기" }),
    false,
  );
  assert.equal(
    matchesStockNews("네이버, 실적 개선", { symbol: "035420", name: "NAVER" }),
    true,
  );
  assert.equal(
    matchesStockNews("기아 문제 해결 지원", { symbol: "000270", name: "기아" }),
    false,
  );
  assert.equal(
    matchesStockNews("기아, 영업이익 증가", { symbol: "000270", name: "기아" }),
    true,
  );
  assert.equal(matchesStockNews("005930 실적 발표", stock), true);
  assert.equal(matchesStockNews("10059301 데이터", stock), false);
});
test("뉴스 수집: 동시 요청 공유·중복 제거·일부 장애·초기 실패와 재시도", async () => {
  let clock = now,
    calls = 0,
    failed = false;
  const fetcher = (async () => {
    calls++;
    if (failed) throw Error("offline");
    return new Response(rss());
  }) as typeof fetch;
  const store = new StockNewsStore(fetcher, () => clock, mkFeeds);
  const [a, b] = await Promise.all([store.get(stock), store.get(stock)]);
  assert.equal(calls, 3);
  assert.deepEqual(a, b);
  assert.equal(a.articles.length, 1);
  assert.equal(a.stale, false);
  failed = true;
  clock += 300001;
  const old = await store.get(stock);
  assert.equal(old.stale, true);
  assert.equal(old.updatedAt, a.updatedAt);
  assert.equal(old.unavailableFeeds.length, 3);
  await store.get(stock);
  assert.equal(calls, 6);
  clock += 7 * 3600000;
  await assert.rejects(store.get(stock));
  let bad = true;
  let attempts = 0;
  const initial = new StockNewsStore(
    (async () => {
      attempts++;
      if (bad) throw Error("offline");
      return new Response(rss());
    }) as typeof fetch,
    () => now + (bad ? 0 : 60001),
    mkFeeds,
  );
  await assert.rejects(initial.get(stock));
  await assert.rejects(initial.get(stock));
  assert.equal(attempts, 3);
  bad = false;
  assert.equal((await initial.get(stock)).articles.length, 1);
  const partial = new StockNewsStore(
    (async (url) => {
      if (String(url).includes("30100041")) throw Error("offline");
      return new Response(rss());
    }) as typeof fetch,
    () => now,
    mkFeeds,
  );
  const p = await partial.get(stock);
  assert.equal(p.stale, true);
  assert.deepEqual(p.unavailableFeeds, ["매일경제 · 경제"]);
});

const sourceLinks = {
  파이낸셜뉴스: "https://www.fnnews.com/news/202609081338589294",
  전자신문: "https://www.etnews.com/20260909000159",
  뉴시스: "https://www.newsis.com/view/NISX20260909_0003782405",
  매일경제: "https://www.mk.co.kr/news/stock/123",
  한국경제: "https://www.hankyung.com/article/202609093724i",
  연합뉴스: "https://www.yna.co.kr/view/AKR20260909101000017",
  비즈니스포스트:
    "https://www.businesspost.co.kr/BP?command=article_view&num=446766",
} as const;
test("언론사별 원문 검증·출처 위조 차단·기사 식별 쿼리 보존", () => {
  for (const [source, url] of Object.entries(sourceLinks)) {
    const key = source as keyof typeof sourceLinks;
    const [article] = parseNewsFeed(rss("삼성전자 실적", url), now, key);
    assert.equal(article.source, source);
    assert.equal(article.url, url);
    const other = key === "매일경제" ? "한국경제" : "매일경제";
    assert.equal(
      parseNewsFeed(rss("삼성전자 실적", url), now, other).length,
      0,
    );
  }
  assert.equal(
    newsUrl(sourceLinks.비즈니스포스트 + "&utm_source=rss", "비즈니스포스트"),
    sourceLinks.비즈니스포스트,
  );
  assert.equal(
    newsUrl(
      "https://www.businesspost.co.kr/BP?command=delete&num=1",
      "비즈니스포스트",
    ),
    null,
  );
  assert.equal(
    newsUrl(
      "https://www.hankyung.com.evil.test/article/202609093724i",
      "한국경제",
    ),
    null,
  );
});
test("다중 언론사 중복 제거·동일 제목 출처 유지·장애 피드만 재시도", async () => {
  let clock = now,
    hkOffline = true;
  const calls: string[] = [];
  const store = new StockNewsStore(
    (async (url) => {
      const feed = NEWS_FEEDS.find((feed) => feed.url === String(url))!;
      calls.push(feed.url);
      if (hkOffline && feed.source === "한국경제") throw Error("offline");
      return new Response(rss("삼성전자 실적", sourceLinks[feed.source]));
    }) as typeof fetch,
    () => clock,
  );
  const first = await store.get(stock);
  assert.equal(first.articles.length, Object.keys(sourceLinks).length - 1);
  assert.equal(first.unavailableFeeds.length, 3);
  assert.equal(calls.length, NEWS_FEEDS.length);
  clock += 60001;
  hkOffline = false;
  const next = await store.get(stock);
  assert.equal(next.articles.length, Object.keys(sourceLinks).length);
  assert.equal(
    new Set(next.articles.map((a) => a.source)).size,
    Object.keys(sourceLinks).length,
  );
  assert.equal(next.stale, false);
  assert.equal(calls.length, NEWS_FEEDS.length + 3);
  assert.ok(
    calls.slice(NEWS_FEEDS.length).every((url) => url.includes("hankyung.com")),
  );
});

test("뉴시스 과거 링크 정규화와 새 언론사 원문 도메인 검증", () => {
  assert.equal(
    newsUrl(
      "https://nwww.newsis.com/view/?id=NISX20260909_0003782405&cID=10401&utm_source=rss",
      "뉴시스",
    ),
    sourceLinks.뉴시스,
  );
  assert.equal(
    newsUrl("https://www.newsis.com/view/?id=../../other", "뉴시스"),
    null,
  );
  assert.equal(
    newsUrl("https://www.etnews.com.evil.test/20260909000159", "전자신문"),
    null,
  );
  assert.equal(
    newsUrl(
      "https://www.fnnews.com/login?next=202609081338589294",
      "파이낸셜뉴스",
    ),
    null,
  );
});
