import type { Store } from "./db";
import type { PerformanceReport } from "../src/learningTypes";
import type { Quote } from "../src/types";

type Marks = { kospi: number | null; kosdaq: number | null };
type Point = Marks & {
  id: number;
  captured_at: number;
  equity: number;
  deposits: number;
  kind: string;
};
const emptyMarks: Marks = { kospi: null, kosdaq: null };
const kstDate = (time: number) =>
  new Date(time + 9 * 3600000).toISOString().slice(0, 10);

/** Separate from legacy view-triggered snapshots: never infer historical flows. */
export class PerformanceStore {
  constructor(private store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS performance_points(
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      captured_at INTEGER NOT NULL, bucket INTEGER NOT NULL, kind TEXT NOT NULL,
      equity INTEGER NOT NULL, deposits INTEGER NOT NULL, kospi REAL, kosdaq REAL);
      CREATE INDEX IF NOT EXISTS performance_user_time ON performance_points(user_id,captured_at,id);
      CREATE UNIQUE INDEX IF NOT EXISTS performance_scheduled_bucket ON performance_points(user_id,bucket) WHERE kind='scheduled';`);
  }
  record(
    user: number,
    equity: number,
    at = Date.now(),
    kind = "scheduled",
    marks = emptyMarks,
  ) {
    if (!Number.isSafeInteger(equity) || equity < 0)
      throw Error("유효한 평가액이 필요합니다.");
    this.store.db
      .prepare(
        `INSERT OR IGNORE INTO performance_points(user_id,captured_at,bucket,kind,equity,deposits,kospi,kosdaq)
      VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        user,
        at,
        Math.floor(at / 300000),
        kind,
        equity,
        this.store.user(user).deposits,
        marks.kospi,
        marks.kosdaq,
      );
  }
  /** Values holdings only after all asynchronous reads, using current cash/quantities. */
  value(user: number, prices: Map<string, Quote>, at = Date.now()) {
    const u = this.store.user(user);
    if (!u) throw Error("회원을 찾을 수 없습니다.");
    let equity = u.cash;
    for (const h of this.store.db
      .prepare(
        "SELECT symbol,quantity FROM holdings WHERE user_id=? AND quantity>0",
      )
      .all(user)) {
      const q = prices.get(String(h.symbol));
      if (
        !q ||
        !Number.isSafeInteger(q.price) ||
        q.price <= 0 ||
        !Number.isFinite(q.receivedAt) ||
        at - q.receivedAt > 60000 ||
        q.receivedAt > at + 1000
      )
        throw Error("최신 시세가 부족하여 계좌 평가를 건너뜁니다.");
      equity += Number(h.quantity) * q.price;
    }
    return equity;
  }
  report(
    user: number,
    range: "all" | "day" | "week" | "month" = "all",
    group: "day" | "week" | "month" = "day",
    now = Date.now(),
  ): PerformanceReport {
    const all = this.store.db
      .prepare(
        "SELECT * FROM performance_points WHERE user_id=? ORDER BY captured_at,id",
      )
      .all(user) as unknown as Point[];
    const days = { all: Infinity, day: 1, week: 7, month: 30 }[range];
    const from = now - days * 86400000;
    // Start with the first observation inside the chosen window; show its actual time.
    const rows = all.filter((p) => p.captured_at >= from);
    const first = rows[0],
      last = rows.at(-1);
    let index = 1,
      peak = 1,
      drawdown = 0,
      flowGap = false,
      collectionGap = false;
    const points: PerformanceReport["points"] = [];
    const groups = new Map<
      string,
      {
        label: string;
        profit: number;
        netGrants: number;
        startIndex: number;
        endIndex: number;
        valid: boolean;
      }
    >();
    const benchmark = (p: Point, key: "kospi" | "kosdaq") =>
      first?.[key] && p[key] ? (p[key]! / first[key]! - 1) * 100 : null;
    rows.forEach((p, i) => {
      const previous = rows[i - 1];
      const flow = previous ? p.deposits - previous.deposits : 0;
      const startIndex = index;
      if (previous) {
        const boundary =
          previous.kind === "flow_before" &&
          p.kind === "flow_after" &&
          previous.captured_at === p.captured_at &&
          p.equity - previous.equity === flow;
        if (flow !== 0 && !boundary) flowGap = true;
        else if (!boundary && previous.equity > 0)
          index *= p.equity / previous.equity;
        else if (!boundary && previous.equity === 0 && p.equity > 0)
          flowGap = true;
        // Overnight gaps are expected; identify missing observations within one session day.
        if (
          kstDate(previous.captured_at) === kstDate(p.captured_at) &&
          p.captured_at - previous.captured_at > 10 * 60000
        )
          collectionGap = true;
        peak = Math.max(peak, index);
        drawdown = Math.min(drawdown, (index / peak - 1) * 100);
        const date = new Date(p.captured_at + 9 * 3600000);
        if (group === "week")
          date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
        const label = date.toISOString().slice(0, group === "month" ? 7 : 10);
        const bucket = groups.get(label) ?? {
          label,
          profit: 0,
          netGrants: 0,
          startIndex,
          endIndex: index,
          valid: !flowGap,
        };
        bucket.profit += p.equity - previous.equity - flow;
        bucket.netGrants += flow;
        bucket.endIndex = index;
        bucket.valid &&= !flowGap;
        groups.set(label, bucket);
      }
      points.push({
        at: p.captured_at,
        equity: p.equity,
        profit: p.equity - first.equity - (p.deposits - first.deposits),
        rate: flowGap ? null : (index - 1) * 100,
        kospi: benchmark(p, "kospi"),
        kosdaq: benchmark(p, "kosdaq"),
      });
    });
    if (flowGap) for (const point of points) point.rate = null;
    // Keep chart payload bounded without dropping the start/end or analysis observations.
    const stride = Math.max(1, Math.ceil(points.length / 500));
    return {
      startedAt: first?.captured_at ?? null,
      lastAt: last?.captured_at ?? null,
      count: rows.length,
      profit:
        last && first
          ? last.equity - first.equity - (last.deposits - first.deposits)
          : null,
      netGrants: last && first ? last.deposits - first.deposits : 0,
      rate: rows.length > 1 && !flowGap ? (index - 1) * 100 : null,
      maxDrawdown: rows.length > 1 && !flowGap ? drawdown : null,
      flowGap,
      collectionGap,
      kospi: last && rows.length > 1 ? benchmark(last, "kospi") : null,
      kosdaq: last && rows.length > 1 ? benchmark(last, "kosdaq") : null,
      points: points.filter(
        (_, i) => i % stride === 0 || i === points.length - 1,
      ),
      periods: [...groups.values()]
        .map((p) => ({
          label: p.label,
          profit: p.profit,
          netGrants: p.netGrants,
          rate:
            p.valid && p.startIndex > 0
              ? (p.endIndex / p.startIndex - 1) * 100
              : null,
        }))
        .reverse()
        .slice(0, 90),
    };
  }
}

/** Shared quotes per symbol, bounded provider concurrency, no dependency on browser sessions. */
export class AccountValuator {
  private running = false;
  constructor(
    private store: Store,
    private performance: PerformanceStore,
    private quote: (symbol: string) => Promise<Quote>,
    readonly indices: () => Promise<Marks>,
  ) {}
  async prices(user?: number) {
    const rows =
      user === undefined
        ? this.store.db
            .prepare("SELECT DISTINCT symbol FROM holdings WHERE quantity>0")
            .all()
        : this.store.db
            .prepare(
              "SELECT symbol FROM holdings WHERE user_id=? AND quantity>0",
            )
            .all(user);
    const result = new Map<string, Quote>();
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, rows.length) }, async () => {
        while (cursor < rows.length) {
          const symbol = String(rows[cursor++].symbol);
          try {
            result.set(symbol, await this.quote(symbol));
          } catch {
            /* Missing values are never replaced by cost or zero. */
          }
        }
      }),
    );
    return result;
  }
  async collect() {
    if (this.running) return;
    this.running = true;
    try {
      const [prices, marks] = await Promise.all([
        this.prices(),
        this.indices().catch(() => emptyMarks),
      ]);
      let skipped = 0;
      for (const u of this.store.db.prepare("SELECT id FROM users").all()) {
        try {
          this.performance.record(
            Number(u.id),
            this.performance.value(Number(u.id), prices),
            Date.now(),
            "scheduled",
            marks,
          );
        } catch {
          skipped++;
        }
      }
      if (skipped)
        console.warn(
          `계좌 평가: 최신 시세가 부족한 ${skipped}개 계좌는 기록하지 않았습니다.`,
        );
    } finally {
      this.running = false;
    }
  }
}
