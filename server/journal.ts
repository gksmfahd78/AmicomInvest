import { z } from "zod";
import type { Store } from "./db";
import type { JournalEntry, TradePlan } from "../src/learningTypes";
import { emptyPlan } from "../src/learningTypes";
import type { Book } from "../src/types";

export const planSchema = z.object({
  horizon: z.string().trim().max(100).default(""),
  invalidation: z.string().trim().max(1000).default(""),
  source: z.string().trim().max(1000).default(""),
});
export const reviewSchema = z.object({
  reason: z.string().trim().max(2000),
  adherence: z.enum(["unreviewed", "followed", "partial", "broken"]),
  lesson: z.string().trim().max(2000),
});
const emptyReview = {
  reason: "",
  adherence: "unreviewed",
  lesson: "",
} as const;
export class JournalStore {
  constructor(private store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS trade_journals(
      order_id INTEGER PRIMARY KEY REFERENCES orders(id), plan TEXT NOT NULL,
      context TEXT, review TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL);`);
  }
  capture(
    user: number,
    order: number,
    plan: TradePlan,
    book: Book,
    inherited?: number,
  ) {
    const o = this.store.db
      .prepare("SELECT id FROM orders WHERE id=? AND user_id=?")
      .get(order, user);
    if (!o) throw Error("주문을 찾을 수 없습니다.");
    const old = inherited
      ? this.store.db
          .prepare("SELECT plan FROM trade_journals WHERE order_id=?")
          .get(inherited)
      : null;
    this.store.db
      .prepare("INSERT OR IGNORE INTO trade_journals VALUES(?,?,?,?,0,?)")
      .run(
        order,
        old ? String(old.plan) : JSON.stringify(planSchema.parse(plan)),
        JSON.stringify({
          capturedAt: book.receivedAt,
          bid: book.bids[0]?.price ?? null,
          ask: book.asks[0]?.price ?? null,
        }),
        JSON.stringify(emptyReview),
        Date.now(),
      );
  }
  list(
    user: number,
    symbol = "",
    page = 0,
    filter: "all" | "unreviewed" | "reviewed" = "all",
  ) {
    const where = `o.user_id=? AND (?='' OR o.symbol=?) AND
      (?='all' OR (?='unreviewed' AND (j.review IS NULL OR json_extract(j.review,'$.adherence')='unreviewed')) OR
      (?='reviewed' AND json_extract(j.review,'$.adherence')<>'unreviewed'))`;
    const args = [user, symbol, symbol, filter, filter, filter];
    const total = Number(
      this.store.db
        .prepare(
          `SELECT COUNT(*) n FROM orders o LEFT JOIN trade_journals j ON o.id=j.order_id WHERE ${where}`,
        )
        .get(...args)!.n,
    );
    const entries = this.store.db
      .prepare(
        `SELECT o.id,o.symbol,o.side,o.quantity,o.filled_quantity,o.status,o.created_at,o.note,o.replaces_id,
      j.plan,j.context,j.review,j.revision,COALESCE((SELECT SUM(f.realized_pnl) FROM fills f WHERE f.order_id=o.id),0) realizedPnl
      FROM orders o LEFT JOIN trade_journals j ON o.id=j.order_id WHERE ${where} ORDER BY o.id DESC LIMIT 20 OFFSET ?`,
      )
      .all(...args, page * 20)
      .map((row) => ({
        ...row,
        plan: row.plan ? JSON.parse(String(row.plan)) : { ...emptyPlan },
        context: row.context ? JSON.parse(String(row.context)) : null,
        review: row.review
          ? JSON.parse(String(row.review))
          : { ...emptyReview },
        revision: Number(row.revision ?? 0),
      })) as unknown as JournalEntry[];
    return { entries, total };
  }
  save(user: number, order: number, revision: number, input: unknown) {
    const review = reviewSchema.parse(input);
    if (review.adherence !== "unreviewed" && (!review.reason || !review.lesson))
      throw Error(
        "복기를 완료하려면 판단 평가와 다음에 바꿀 점을 작성해주세요.",
      );
    return this.store.transaction(() => {
      const o = this.store.db
        .prepare("SELECT id FROM orders WHERE id=? AND user_id=?")
        .get(order, user);
      if (!o) throw Error("주문을 찾을 수 없습니다.");
      const row = this.store.db
        .prepare("SELECT revision,review FROM trade_journals WHERE order_id=?")
        .get(order);
      const data = JSON.stringify(review);
      if (row?.review === data) return { revision: Number(row.revision) };
      if (Number(row?.revision ?? 0) !== revision)
        throw Error(
          "다른 화면에서 복기가 수정되었습니다. 목록을 새로고침한 뒤 다시 열어주세요.",
        );
      this.store.db
        .prepare(
          `INSERT INTO trade_journals VALUES(?,?,NULL,?,?,?)
        ON CONFLICT(order_id) DO UPDATE SET review=excluded.review,revision=excluded.revision,updated_at=excluded.updated_at`,
        )
        .run(order, JSON.stringify(emptyPlan), data, revision + 1, Date.now());
      return { revision: revision + 1 };
    });
  }
}
