export const NEWS_SOURCES = [
  "매일경제",
  "한국경제",
  "연합뉴스",
  "비즈니스포스트",
  "파이낸셜뉴스",
  "전자신문",
  "뉴시스",
] as const;
export type NewsSource = (typeof NEWS_SOURCES)[number];
export type StockNewsArticle = {
  title: string;
  url: string;
  publishedAt: string;
  source: NewsSource;
};
export type StockNewsResponse = {
  symbol: string;
  name: string;
  articles: StockNewsArticle[];
  updatedAt: string;
  stale: boolean;
  unavailableFeeds: string[];
};
