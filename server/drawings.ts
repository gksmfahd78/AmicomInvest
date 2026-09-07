import { z } from "zod";
import type { Store } from "./db";
export const drawingsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(100),
      tool: z.enum(["trend", "horizontal", "rectangle", "pen"]),
      color: z.string().regex(/^#[0-9a-f]{6}$/i),
      width: z.number().int().min(1).max(4),
      points: z
        .array(
          z.object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            offset: z.number().finite().min(0).max(1),
            price: z.number().finite().min(-1000000000).max(1000000000),
          }),
        )
        .min(1)
        .max(600),
    }),
  )
  .max(200)
  .refine(
    (v) => new Set(v.map((d) => d.id)).size === v.length,
    "그림 ID가 중복됩니다.",
  );
export class DrawingsStore {
  constructor(private store: Store) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS chart_drawings(user_id INTEGER REFERENCES users(id),symbol TEXT,period TEXT,revision INTEGER NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,symbol,period))",
    );
  }
  get(user: number, symbol: string, period: string) {
    const row = this.store.db
      .prepare(
        "SELECT revision,data,updated_at FROM chart_drawings WHERE user_id=? AND symbol=? AND period=?",
      )
      .get(user, symbol, period);
    return {
      revision: Number(row?.revision || 0),
      drawings: row ? JSON.parse(String(row.data)) : [],
      updatedAt: row?.updated_at ?? null,
    };
  }
  save(
    user: number,
    symbol: string,
    period: string,
    revision: number,
    drawings: unknown,
  ) {
    const data = JSON.stringify(drawingsSchema.parse(drawings));
    return this.store.transaction(() => {
      const old = this.get(user, symbol, period);
      if (JSON.stringify(old.drawings) === data) return old;
      if (old.revision !== revision)
        throw Error(
          "다른 화면에서 그림이 변경되었습니다. 서버 그림을 다시 불러와 주세요.",
        );
      this.store.db
        .prepare(
          "INSERT INTO chart_drawings VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,symbol,period) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at",
        )
        .run(user, symbol, period, revision + 1, data, Date.now());
      return this.get(user, symbol, period);
    });
  }
}
