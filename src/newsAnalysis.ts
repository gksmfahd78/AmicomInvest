import type { StockNewsArticle } from "./newsTypes";
import type { Candle } from "./types";
export const NEWS_CATEGORIES = {
  earnings: "실적",
  contract: "수주·계약",
  shareholder: "배당·자사주",
  financing: "증자·자금조달",
  mna: "인수·합병",
  legal: "소송·규제",
  product: "제품·기술",
  analyst: "증권사 분석",
  market: "주가·시장",
  other: "기타",
} as const;
export type NewsCategory = keyof typeof NEWS_CATEGORIES;
const rules: [NewsCategory, RegExp][] = [
  ["earnings", /영업이익|순이익|매출|실적|흑자|적자|어닝/],
  ["contract", /수주|공급\s*계약|납품\s*계약|계약\s*체결/],
  ["shareholder", /배당|자사주|주주\s*환원|주식\s*소각/],
  ["financing", /증자|전환사채|신주인수권|자금\s*조달|회사채|CB\s*발행/i],
  ["mna", /인수(?!권)|합병|매각|M\s*&\s*A/i],
  ["legal", /소송|제소|판결|과징금|규제|검찰|압수수색|공정위|거래\s*정지/],
  ["product", /신제품|신기술|출시|특허|개발|양산|임상|신약/],
  ["analyst", /목표\s*주가|목표가|투자\s*의견|리포트|증권사/],
  ["market", /주가|상한가|하한가|급등|급락|신고가|신저가|증시/],
];
export type NewsTag = { category: NewsCategory; evidence: string };
export function classifyNews(title: string): NewsTag[] {
  const tags = rules.flatMap(([category, pattern]) => {
    const match = title.normalize("NFKC").match(pattern);
    return match ? [{ category, evidence: match[0] }] : [];
  });
  return tags.length ? tags : [{ category: "other", evidence: "" }];
}
export const newsDay = (at: string) =>
  new Date(Date.parse(at) + 9 * 3600000).toISOString().slice(0, 10);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function normalizedTitle(title: string, name: string) {
  let text = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[(?:속보|특징주|종합|단독|포토|영상)\]/g, " ");
  for (const alias of [
    name,
    ...(name.toLowerCase() === "naver" ? ["네이버"] : []),
  ])
    if (alias)
      text = text.replace(new RegExp(escape(alias.toLowerCase()), "g"), " ");
  return text
    .replace(/(\d)조원/g, "$1조")
    .replace(/(\d)억원/g, "$1억")
    .replace(/[^\p{L}\p{N}%.+-]+/gu, " ")
    .trim();
}
function words(text: string) {
  return new Set(
    text
      .split(/\s+/)
      .map((word) =>
        word.length > 3
          ? word.replace(/(?:에서|으로|은|는|을|를|의)$/, "")
          : word,
      )
      .filter(
        (word) =>
          word.length > 1 &&
          !["관련", "소식", "발표", "기자", "오늘", "이번"].includes(word),
      ),
  );
}
function pairs(text: string) {
  const plain = text.replace(/\s/g, "");
  return new Set([...plain].slice(1).map((_, i) => plain.slice(i, i + 2)));
}
function intersection(a: Set<string>, b: Set<string>) {
  return [...a].filter((value) => b.has(value)).length;
}
export function similarNews(
  a: StockNewsArticle,
  b: StockNewsArticle,
  name: string,
): boolean {
  if (
    Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) >
    36 * 3600000
  )
    return false;
  const x = normalizedTitle(a.title, name),
    y = normalizedTitle(b.title, name);
  if (!x || !y) return false;
  const numbers = (s: string) =>
    (s.match(/[+-]?\d+(?:\.\d+)?(?:%|조|억|만|분기|년|월|일)?/g) ?? [])
      .sort()
      .join("|");
  if (numbers(x) !== numbers(y)) return false;
  const denied = (s: string) =>
    /부인|아니|없|무산|취소|철회|해지|실패|사실무근|미확정|미정|않|안\s*(?:해|하|했|된|되)/.test(
      s,
    );
  if (denied(x) !== denied(y)) return false;
  if (x === y) return true;
  const direction = (s: string) => ({
    up: /증가|상승|확대|개선|흑자|상향/.test(s),
    down: /감소|하락|축소|악화|적자|하향/.test(s),
  });
  const dx = direction(x),
    dy = direction(y);
  if ((dx.up && dy.down) || (dx.down && dy.up)) return false;
  const tx = words(x),
    ty = words(y),
    common = intersection(tx, ty);
  const ax = classifyNews(a.title),
    ay = classifyNews(b.title);
  if (!ax.some((tag) => ay.some((other) => other.category === tag.category)))
    return false;
  const px = pairs(x),
    py = pairs(y),
    dice = (2 * intersection(px, py)) / Math.max(1, px.size + py.size);
  return (
    (common >= 3 && common / (tx.size + ty.size - common) >= 0.65) ||
    (common >= 2 && dice >= 0.86)
  );
}
export type NewsIssue = {
  id: string;
  lead: StockNewsArticle;
  articles: StockNewsArticle[];
  tags: NewsTag[];
};
export function groupNews(
  articles: StockNewsArticle[],
  name: string,
): NewsIssue[] {
  const unique = [
    ...new Map(articles.map((article) => [article.url, article])).values(),
  ].sort(
    (a, b) =>
      a.publishedAt.localeCompare(b.publishedAt) || a.url.localeCompare(b.url),
  );
  const groups: StockNewsArticle[][] = [];
  for (const article of unique) {
    const group = groups.find((items) =>
      items.every((item) => similarNews(article, item, name)),
    );
    if (group) group.push(article);
    else groups.push([article]);
  }
  return groups
    .map((items) => {
      const ordered = [...items].sort(
        (a, b) =>
          b.publishedAt.localeCompare(a.publishedAt) ||
          a.url.localeCompare(b.url),
      );
      return {
        id: items[0].url,
        lead: ordered[0],
        articles: ordered,
        tags: classifyNews(ordered[0].title),
      };
    })
    .sort(
      (a, b) =>
        b.lead.publishedAt.localeCompare(a.lead.publishedAt) ||
        a.id.localeCompare(b.id),
    );
}
export function newsCandleContext(article: StockNewsArticle, bars: Candle[]) {
  const day = newsDay(article.publishedAt);
  const index = bars.findIndex((bar) => bar.date === day);
  const at = new Date(Date.parse(article.publishedAt) + 9 * 3600000);
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  const session =
    minutes < 540 ? "장 시작 전" : minutes >= 930 ? "장 마감 후" : "장중";
  const bar = index < 0 ? null : bars[index];
  const previous = index > 0 ? bars[index - 1] : null;
  return {
    day,
    index,
    bar,
    session,
    dayChange:
      bar && previous && previous.close > 0
        ? (bar.close / previous.close - 1) * 100
        : null,
  };
}
