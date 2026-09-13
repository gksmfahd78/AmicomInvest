import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Stock } from "../src/types";
import type {
  StockNewsArticle,
  StockNewsResponse,
  NewsSource,
} from "../src/newsTypes";
export type NewsFeed = { name: string; source: NewsSource; url: string };
export const NEWS_FEEDS: readonly NewsFeed[] = [
  {
    source: "매일경제",
    name: "증권",
    url: "https://www.mk.co.kr/rss/50200011/",
  },
  {
    source: "매일경제",
    name: "기업·경영",
    url: "https://www.mk.co.kr/rss/50100032/",
  },
  {
    source: "매일경제",
    name: "경제",
    url: "https://www.mk.co.kr/rss/30100041/",
  },
  {
    source: "한국경제",
    name: "증권",
    url: "https://www.hankyung.com/feed/finance",
  },
  {
    source: "한국경제",
    name: "경제",
    url: "https://www.hankyung.com/feed/economy",
  },
  { source: "한국경제", name: "IT", url: "https://www.hankyung.com/feed/it" },
  {
    source: "연합뉴스",
    name: "경제",
    url: "https://www.yna.co.kr/rss/economy.xml",
  },
  {
    source: "비즈니스포스트",
    name: "기업·산업",
    url: "https://www.businesspost.co.kr/rss/Article_3.xml",
  },
  {
    source: "비즈니스포스트",
    name: "시장·머니",
    url: "https://www.businesspost.co.kr/rss/Article_5.xml",
  },
  {
    source: "파이낸셜뉴스",
    name: "증권",
    url: "https://www.fnnews.com/rss/r20/fn_realnews_stock.xml",
  },
  {
    source: "파이낸셜뉴스",
    name: "산업",
    url: "https://www.fnnews.com/rss/r20/fn_realnews_industry.xml",
  },
  {
    source: "전자신문",
    name: "전자·반도체",
    url: "https://rss.etnews.com/06.xml",
  },
  { source: "전자신문", name: "SW·AI", url: "https://rss.etnews.com/04.xml" },
  {
    source: "전자신문",
    name: "경제·금융",
    url: "https://rss.etnews.com/02.xml",
  },
  {
    source: "뉴시스",
    name: "산업",
    url: "https://nwww.newsis.com/RSS/industry.xml",
  },
  {
    source: "뉴시스",
    name: "금융",
    url: "https://nwww.newsis.com/RSS/bank.xml",
  },
];
const MAX_BYTES = 1000000,
  WEEK = 7 * 86400000;
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (_name, path) => path === "rss.channel.item",
});
export function newsUrl(
  value: unknown,
  source: NewsSource = "매일경제",
): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.port || url.username || url.password)
      return null;
    if (
      source === "매일경제" &&
      ["www.mk.co.kr", "mk.co.kr"].includes(url.hostname) &&
      /^\/news\/[a-z-]+\/\d+\/?$/.test(url.pathname)
    )
      return "https://www.mk.co.kr" + url.pathname.replace(/\/$/, "");
    if (
      source === "한국경제" &&
      ["www.hankyung.com", "hankyung.com"].includes(url.hostname) &&
      /^\/article\/[0-9A-Za-z]{10,24}\/?$/.test(url.pathname)
    )
      return "https://www.hankyung.com" + url.pathname.replace(/\/$/, "");
    if (
      source === "연합뉴스" &&
      ["www.yna.co.kr", "yna.co.kr"].includes(url.hostname) &&
      /^\/view\/AKR[0-9]{10,24}\/?$/.test(url.pathname)
    )
      return "https://www.yna.co.kr" + url.pathname.replace(/\/$/, "");
    if (
      source === "비즈니스포스트" &&
      ["www.businesspost.co.kr", "businesspost.co.kr"].includes(url.hostname) &&
      url.pathname === "/BP" &&
      url.searchParams.get("command") === "article_view" &&
      /^\d{1,12}$/.test(url.searchParams.get("num") ?? "")
    )
      return (
        "https://www.businesspost.co.kr/BP?command=article_view&num=" +
        url.searchParams.get("num")
      );
    if (
      source === "파이낸셜뉴스" &&
      ["www.fnnews.com", "fnnews.com"].includes(url.hostname) &&
      /^\/news\/\d{12,24}\/?$/.test(url.pathname)
    )
      return "https://www.fnnews.com" + url.pathname.replace(/\/$/, "");
    if (
      source === "전자신문" &&
      ["www.etnews.com", "etnews.com"].includes(url.hostname) &&
      /^\/\d{12,20}\/?$/.test(url.pathname)
    )
      return "https://www.etnews.com" + url.pathname.replace(/\/$/, "");
    if (
      source === "뉴시스" &&
      ["www.newsis.com", "newsis.com", "nwww.newsis.com"].includes(url.hostname)
    ) {
      const id =
        url.pathname.match(/^\/view\/(NISX\d{8}_\d{7,12})\/?$/)?.[1] ??
        (/^\/view\/?$/.test(url.pathname) ? url.searchParams.get("id") : null);
      if (id && /^NISX\d{8}_\d{7,12}$/.test(id))
        return "https://www.newsis.com/view/" + id;
    }
    return null;
  } catch {
    return null;
  }
}
export function parseNewsFeed(
  xml: string,
  now = Date.now(),
  source: NewsSource = "매일경제",
): StockNewsArticle[] {
  if (
    Buffer.byteLength(xml) > MAX_BYTES ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw Error("뉴스 피드 형식 오류");
  const channel = parser.parse(xml)?.rss?.channel;
  if (!channel || typeof channel !== "object")
    throw Error("뉴스 피드 형식 오류");
  const unique = new Map<string, StockNewsArticle>();
  for (const item of channel.item ?? []) {
    const url = newsUrl(item.link, source);
    const title =
      typeof item.title === "string"
        ? item.title
            .replace(/<[^>]*>/g, "")
            .replace(/\s+/g, " ")
            .trim()
        : "";
    const date =
      typeof item.pubDate === "string" ? Date.parse(item.pubDate) : NaN;
    if (
      !url ||
      !title ||
      title.length > 500 ||
      !Number.isFinite(date) ||
      date > now + 300000 ||
      date < now - WEEK
    )
      continue;
    unique.set(url, {
      title,
      url,
      publishedAt: new Date(date).toISOString(),
      source,
    });
  }
  return [...unique.values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 500);
}
const aliases: Record<string, string[]> = { "035420": ["네이버"] };
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function matchesStockNews(
  title: string,
  stock: Pick<Stock, "symbol" | "name">,
): boolean {
  const value = title.normalize("NFKC");
  if (
    new RegExp(
      "(?<![0-9A-Za-z])" + escape(stock.symbol) + "(?![0-9A-Za-z])",
      "u",
    ).test(value)
  )
    return true;
  return [stock.name, ...(aliases[stock.symbol] ?? [])].some((name) => {
    const term = name.normalize("NFKC").replace(/\s+/g, "");
    if (term.length < 2) return false;
    if (
      term.length <= 2 &&
      !/주가|주식|증시|코스피|코스닥|상한가|하한가|실적|영업이익|매출|배당|증권|공시|수주|자사주|목표가|상장/.test(
        value,
      )
    )
      return false;
    const expression =
      "(?<![\\p{L}\\p{N}])" +
      [...term].map(escape).join("\\s*") +
      "(?=$|[^\\p{L}\\p{N}]|(?:은|는|이|가|을|를|의|와|과|도|에|에서|으로|로)(?=$|[^\\p{L}\\p{N}]))";
    return new RegExp(expression, "iu").test(value);
  });
}
async function readFeed(fetcher: typeof fetch, url: string) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok || !response.body) throw Error("뉴스 공급 응답 오류");
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body.cancel();
    throw Error("뉴스 크기 초과");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw Error("뉴스 크기 초과");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
export class StockNewsStore {
  private feeds = new Map<
    string,
    { articles: StockNewsArticle[]; at: number }
  >();
  private pending: Promise<void> | null = null;
  private nextAttempts = new Map<string, number>();
  private failed = new Set<string>();
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now = Date.now,
    private readonly definitions: readonly NewsFeed[] = NEWS_FEEDS,
  ) {}
  private async refresh() {
    if (this.pending) return this.pending;
    const due = this.definitions.filter(
      (feed) => this.now() >= (this.nextAttempts.get(feed.url) ?? -Infinity),
    );
    if (!due.length) return;
    this.pending = (async () => {
      await Promise.allSettled(
        due.map(async (feed) => {
          try {
            const articles = parseNewsFeed(
              await readFeed(this.fetcher, feed.url),
              this.now(),
              feed.source,
            );
            this.feeds.set(feed.url, { articles, at: this.now() });
            this.failed.delete(feed.url);
            this.nextAttempts.set(feed.url, this.now() + 300000);
          } catch {
            this.failed.add(feed.url);
            this.nextAttempts.set(feed.url, this.now() + 60000);
          }
        }),
      );
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async get(stock: Pick<Stock, "symbol" | "name">): Promise<StockNewsResponse> {
    await this.refresh();
    const feeds = [...this.feeds.values()].filter(
      (feed) => this.now() - feed.at < 6 * 3600000,
    );
    if (!feeds.length)
      throw Error("뉴스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    const unique = new Map<string, StockNewsArticle>();
    for (const feed of feeds)
      for (const item of feed.articles)
        if (
          this.now() - Date.parse(item.publishedAt) <= WEEK &&
          matchesStockNews(item.title, stock)
        )
          unique.set(item.url, item);
    const counts = new Map<NewsSource, number>();
    const articles = [...unique.values()]
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .filter((article) => {
        const count = counts.get(article.source) ?? 0;
        counts.set(article.source, count + 1);
        return count < 20;
      });
    return {
      symbol: stock.symbol,
      name: stock.name,
      articles,
      updatedAt: new Date(
        Math.min(...feeds.map((feed) => feed.at)),
      ).toISOString(),
      stale: this.failed.size > 0,
      unavailableFeeds: this.definitions
        .filter((feed) => this.failed.has(feed.url))
        .map((feed) => feed.source + " · " + feed.name),
    };
  }
}
