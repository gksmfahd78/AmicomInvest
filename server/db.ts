import { validatePrice } from "../src/tradingRules";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Order, User, Book } from "../src/types";
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(hash, "hex"),
  );
}
export class Store {
  db: DatabaseSync;
  private depth = 0;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
 PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'member',cash INTEGER NOT NULL DEFAULT 0 CHECK(cash>=0),deposits INTEGER NOT NULL DEFAULT 0,realized INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS holdings(user_id INTEGER REFERENCES users(id),symbol TEXT,quantity INTEGER NOT NULL CHECK(quantity>=0),cost INTEGER NOT NULL CHECK(cost>=0),PRIMARY KEY(user_id,symbol));
 CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),symbol TEXT NOT NULL,side TEXT NOT NULL,type TEXT NOT NULL,quantity INTEGER NOT NULL,limit_price INTEGER,status TEXT NOT NULL,fill_price INTEGER,created_at TEXT DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),note TEXT NOT NULL DEFAULT '',request_id TEXT NOT NULL,UNIQUE(user_id,request_id));
 CREATE TABLE IF NOT EXISTS grants(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),admin_id INTEGER REFERENCES users(id),amount INTEGER NOT NULL,note TEXT NOT NULL,created_at TEXT DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),request_id TEXT UNIQUE NOT NULL);
 `);
    const columns = this.db.prepare("PRAGMA table_info(orders)").all();
    if (!columns.some((c) => c.name === "filled_quantity"))
      this.transaction(() => {
        this.db.exec(
          "ALTER TABLE orders ADD COLUMN filled_quantity INTEGER NOT NULL DEFAULT 0; ALTER TABLE orders ADD COLUMN filled_value INTEGER NOT NULL DEFAULT 0;",
        );
        this.db.exec(
          "UPDATE orders SET filled_quantity=quantity,filled_value=quantity*fill_price WHERE status='filled'",
        );
      });
    for (const [name, definition] of [
      ["expires_at", "INTEGER"],
      ["cancel_reason", "TEXT"],
      ["replaces_id", "INTEGER"],
    ]) {
      if (!columns.some((c) => c.name === name))
        this.db.exec(
          "ALTER TABLE orders ADD COLUMN " + name + " " + definition,
        );
    }
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS fills(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),quantity INTEGER NOT NULL,price INTEGER NOT NULL,created_at TEXT DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS book_state(symbol TEXT PRIMARY KEY,snapshot TEXT NOT NULL,received_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS liquidity(symbol TEXT NOT NULL,side TEXT NOT NULL,price INTEGER NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>=0),PRIMARY KEY(symbol,side,price));`);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS liquidity_used(symbol TEXT,side TEXT,price INTEGER,quantity INTEGER NOT NULL,PRIMARY KEY(symbol,side,price))",
    );
    // Recover already consumed amounts when upgrading an existing database.
    for (const state of this.db.prepare("SELECT * FROM book_state").all()) {
      const snapshot = JSON.parse(String(state.snapshot));
      for (const [side, levels] of [
        ["ask", snapshot.asks],
        ["bid", snapshot.bids],
      ] as const) {
        for (const level of levels) {
          const remaining = this.db
            .prepare(
              "SELECT quantity FROM liquidity WHERE symbol=? AND side=? AND price=?",
            )
            .get(state.symbol!, side, level.price);
          this.db
            .prepare("INSERT OR IGNORE INTO liquidity_used VALUES(?,?,?,?)")
            .run(
              state.symbol!,
              side,
              level.price,
              Math.max(
                0,
                level.quantity - Number(remaining?.quantity ?? level.quantity),
              ),
            );
        }
      }
    }
    this.db.exec(
      "INSERT INTO fills(order_id,quantity,price,created_at) SELECT id,filled_quantity,fill_price,created_at FROM orders WHERE filled_quantity>0 AND NOT EXISTS(SELECT 1 FROM fills WHERE order_id=orders.id)",
    );
  }

  transaction<T>(fn: () => T): T {
    const depth = this.depth++;
    const savepoint = "nested_" + depth;
    try {
      this.db.exec(depth ? "SAVEPOINT " + savepoint : "BEGIN IMMEDIATE");
      try {
        const result = fn();
        this.db.exec(depth ? "RELEASE " + savepoint : "COMMIT");
        return result;
      } catch (e) {
        this.db.exec(depth ? "ROLLBACK TO " + savepoint : "ROLLBACK");
        if (depth) this.db.exec("RELEASE " + savepoint);
        throw e;
      }
    } finally {
      this.depth--;
    }
  }
  expire(now = Date.now()) {
    return this.db
      .prepare(
        "UPDATE orders SET status='cancelled',cancel_reason='장 마감 만료' WHERE status='pending' AND expires_at IS NOT NULL AND expires_at<=?",
      )
      .run(now);
  }
  user(id: number) {
    return this.db
      .prepare(
        "SELECT id,username,name,role,cash,deposits,realized FROM users WHERE id=?",
      )
      .get(id) as unknown as User & {
      cash: number;
      deposits: number;
      realized: number;
    };
  }
  createUser(
    username: string,
    name: string,
    password: string,
    role = "member",
  ) {
    const r = this.db
      .prepare("INSERT INTO users(username,name,password,role) VALUES(?,?,?,?)")
      .run(username, name, hashPassword(password), role);
    return this.user(Number(r.lastInsertRowid));
  }
  reservedCash(id: number) {
    return Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM((quantity-filled_quantity)*limit_price),0) AS value FROM orders WHERE user_id=? AND status='pending' AND side='buy'",
        )
        .get(id)!.value,
    );
  }
  reservedShares(id: number, symbol: string) {
    return Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM(quantity-filled_quantity),0) AS value FROM orders WHERE user_id=? AND symbol=? AND status='pending' AND side='sell'",
        )
        .get(id, symbol)!.value,
    );
  }
  grant(
    admin: number,
    user: number,
    amount: number,
    note: string,
    requestId: string,
  ) {
    return this.transaction(() => {
      const old = this.db
        .prepare("SELECT id FROM grants WHERE request_id=?")
        .get(requestId);
      if (old) return old;
      if (!this.user(user)) throw Error("회원을 찾을 수 없습니다.");
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000)
        throw Error("지급액은 1원~10억 원이어야 합니다.");
      if (this.user(user).deposits + amount > 1000000000000)
        throw Error("누적 지급 한도를 초과했습니다.");
      this.db
        .prepare("UPDATE users SET cash=cash+?,deposits=deposits+? WHERE id=?")
        .run(amount, amount, user);
      return this.db
        .prepare(
          "INSERT INTO grants(user_id,admin_id,amount,note,request_id) VALUES(?,?,?,?,?)",
        )
        .run(user, admin, amount, note, requestId);
    });
  }
  private useBook(symbol: string, book: Book) {
    if (
      !Number.isFinite(book.receivedAt) ||
      Date.now() - book.receivedAt > 20000 ||
      book.receivedAt > Date.now() + 1000
    )
      throw Error("호가가 오래되었거나 유효하지 않습니다.");
    const normalize = (rows: Book["asks"], ascending: boolean) => {
      const seen = new Set<number>();
      const clean = rows.filter((r) => r.price !== 0 && r.quantity !== 0);
      for (const r of clean) {
        if (
          !Number.isSafeInteger(r.price) ||
          r.price <= 0 ||
          !Number.isSafeInteger(r.quantity) ||
          r.quantity < 0 ||
          seen.has(r.price)
        )
          throw Error("유효하지 않은 호가입니다.");
        seen.add(r.price);
      }
      return [...clean].sort((a, b) =>
        ascending ? a.price - b.price : b.price - a.price,
      );
    };
    const asks = normalize(book.asks, true),
      bids = normalize(book.bids, false);
    if (asks.length && bids.length && bids[0].price >= asks[0].price)
      throw Error("호가가 교차해 체결을 잠시 보류합니다.");
    const snapshot = JSON.stringify({ asks, bids });
    const old = this.db
      .prepare("SELECT * FROM book_state WHERE symbol=?")
      .get(symbol);
    if (old && Number(old.received_at) > book.receivedAt)
      throw Error("새 호가가 도착했습니다. 다시 시도해주세요.");

    const sessionDay = (at: number) =>
      new Date(at + 9 * 3600000).toISOString().slice(0, 10);
    const newDay =
      old &&
      sessionDay(Number(old.received_at)) !== sessionDay(book.receivedAt);
    if (newDay)
      this.db.prepare("DELETE FROM liquidity_used WHERE symbol=?").run(symbol);
    if (!old || old.snapshot !== snapshot || newDay) {
      this.db.prepare("DELETE FROM liquidity WHERE symbol=?").run(symbol);
      for (const [side, levels] of [
        ["ask", asks],
        ["bid", bids],
      ] as const)
        for (const l of levels)
          this.db
            .prepare("INSERT INTO liquidity VALUES(?,?,?,?)")
            .run(
              symbol,
              side,
              l.price,
              Math.max(
                0,
                l.quantity -
                  Number(
                    this.db
                      .prepare(
                        "SELECT quantity FROM liquidity_used WHERE symbol=? AND side=? AND price=?",
                      )
                      .get(symbol, side, l.price)?.quantity || 0,
                  ),
              ),
            );
    }
    this.db
      .prepare(
        "INSERT INTO book_state VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET snapshot=excluded.snapshot,received_at=excluded.received_at",
      )
      .run(symbol, snapshot, book.receivedAt);
  }
  place(
    user: number,
    input: {
      symbol: string;
      side: "buy" | "sell";
      type: "market" | "limit";
      quantity: number;
      limitPrice?: number;
      note: string;
      requestId: string;
      expiresAt?: number;
    },
    book: Book,
  ) {
    return this.transaction(() => {
      const old = this.db
        .prepare("SELECT * FROM orders WHERE user_id=? AND request_id=?")
        .get(user, input.requestId);
      if (old) return old;
      const { symbol, side, type, quantity } = input;
      const limit = type === "limit" ? input.limitPrice! : null;
      if (
        !["buy", "sell"].includes(side) ||
        !["market", "limit"].includes(type) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 1000000 ||
        (type === "limit" &&
          (!Number.isSafeInteger(limit) ||
            limit! < 1 ||
            !Number.isSafeInteger(limit! * quantity)))
      )
        throw Error("주문 가격 또는 수량이 올바르지 않습니다.");
      if (input.type === "limit") validatePrice(input.limitPrice!);
      this.expire();
      if (input.expiresAt !== undefined && input.expiresAt <= Date.now())
        throw Error("주문 유효 시간이 지났습니다.");
      this.useBook(symbol, book);
      // Settle earlier orders first so incoming orders cannot jump the queue.
      this.matchCurrent(symbol);
      const held = this.db
        .prepare("SELECT quantity FROM holdings WHERE user_id=? AND symbol=?")
        .get(user, symbol);
      if (
        side === "sell" &&
        Number(held?.quantity ?? 0) - this.reservedShares(user, symbol) <
          quantity
      )
        throw Error("매도 가능한 주식이 부족합니다.");
      let required = 0;
      if (type === "limit") required = limit! * quantity;
      else {
        const levels = this.db
          .prepare(
            "SELECT price,quantity FROM liquidity WHERE symbol=? AND side=? ORDER BY " +
              (side === "buy" ? "price ASC" : "price DESC"),
          )
          .all(symbol, side === "buy" ? "ask" : "bid");
        let remaining = quantity;
        for (const l of levels) {
          const take = Math.min(remaining, Number(l.quantity));
          required += take * Number(l.price);
          remaining -= take;
          if (!remaining) break;
        }
        if (remaining === quantity)
          throw Error("체결 가능한 상대 호가 잔량이 없습니다.");
      }
      if (!Number.isSafeInteger(required))
        throw Error("주문 금액 한도를 초과했습니다.");
      if (
        side === "buy" &&
        this.user(user).cash - this.reservedCash(user) < required
      )
        throw Error("주문 가능한 현금이 부족합니다.");
      const result = this.db
        .prepare(
          "INSERT INTO orders(user_id,symbol,side,type,quantity,limit_price,status,note,request_id) VALUES(?,?,?,?,?,?,'pending',?,?)",
        )
        .run(
          user,
          symbol,
          side,
          type,
          quantity,
          limit,
          input.note,
          input.requestId,
        );
      const id = Number(result.lastInsertRowid);
      this.db
        .prepare("UPDATE orders SET expires_at=? WHERE id=?")
        .run(input.expiresAt ?? null, id);
      this.matchCurrent(symbol);
      if (type === "market")
        this.db
          .prepare(
            "UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'",
          )
          .run(id);
      return this.db.prepare("SELECT * FROM orders WHERE id=?").get(id);
    });
  }
  private fill(orderId: number, quantity: number, price: number) {
    const o = this.db
      .prepare("SELECT * FROM orders WHERE id=?")
      .get(orderId) as unknown as Order & { user_id: number };
    const total = quantity * price;
    if (o.side === "buy") {
      this.db
        .prepare("UPDATE users SET cash=cash-? WHERE id=?")
        .run(total, o.user_id);
      this.db
        .prepare(
          "INSERT INTO holdings(user_id,symbol,quantity,cost) VALUES(?,?,?,?) ON CONFLICT(user_id,symbol) DO UPDATE SET quantity=quantity+excluded.quantity,cost=cost+excluded.cost",
        )
        .run(o.user_id, o.symbol, quantity, total);
    } else {
      const held = this.db
        .prepare(
          "SELECT quantity,cost FROM holdings WHERE user_id=? AND symbol=?",
        )
        .get(o.user_id, o.symbol) as { quantity: number; cost: number };
      if (!held || held.quantity < quantity) throw Error("보유 수량 오류");
      const removed =
        quantity === held.quantity
          ? held.cost
          : Math.round((held.cost * quantity) / held.quantity);
      this.db
        .prepare("UPDATE users SET cash=cash+?,realized=realized+? WHERE id=?")
        .run(total, total - removed, o.user_id);
      this.db
        .prepare(
          "UPDATE holdings SET quantity=quantity-?,cost=cost-? WHERE user_id=? AND symbol=?",
        )
        .run(quantity, removed, o.user_id, o.symbol);
    }
    const filled = o.filled_quantity + quantity,
      value = o.filled_value + total;
    this.db
      .prepare(
        "UPDATE orders SET filled_quantity=?,filled_value=?,fill_price=?,status=? WHERE id=?",
      )
      .run(
        filled,
        value,
        value / filled,
        filled === o.quantity ? "filled" : "pending",
        orderId,
      );
    this.db
      .prepare("INSERT INTO fills(order_id,quantity,price) VALUES(?,?,?)")
      .run(orderId, quantity, price);
  }
  private matchCurrent(symbol: string) {
    this.expire();
    // Price priority, then receipt order, separately for each side.
    for (const side of ["buy", "sell"] as const) {
      const orders = this.db
        .prepare(
          "SELECT * FROM orders WHERE symbol=? AND status='pending' AND side=? ORDER BY CASE WHEN type='market' THEN 0 ELSE 1 END, limit_price " +
            (side === "buy" ? "DESC" : "ASC") +
            ",id ASC",
        )
        .all(symbol, side) as unknown as (Order & { user_id: number })[];
      for (const o of orders) {
        let remaining = o.quantity - o.filled_quantity;
        const levels = this.db
          .prepare(
            "SELECT price,quantity FROM liquidity WHERE symbol=? AND side=? AND quantity>0 ORDER BY price " +
              (side === "buy" ? "ASC" : "DESC"),
          )
          .all(symbol, side === "buy" ? "ask" : "bid");
        for (const l of levels) {
          const price = Number(l.price);
          if (
            o.type === "limit" &&
            (side === "buy" ? price > o.limit_price! : price < o.limit_price!)
          )
            break;
          let take = Math.min(remaining, Number(l.quantity));
          if (o.type === "market" && side === "buy")
            take = Math.min(
              take,
              Math.floor(
                (this.user(o.user_id).cash - this.reservedCash(o.user_id)) /
                  price,
              ),
            );
          if (take <= 0) break;
          this.fill(o.id, take, price);
          this.db
            .prepare(
              "INSERT INTO liquidity_used VALUES(?,?,?,?) ON CONFLICT(symbol,side,price) DO UPDATE SET quantity=quantity+excluded.quantity",
            )
            .run(symbol, side === "buy" ? "ask" : "bid", price, take);
          this.db
            .prepare(
              "UPDATE liquidity SET quantity=quantity-? WHERE symbol=? AND side=? AND price=?",
            )
            .run(take, symbol, side === "buy" ? "ask" : "bid", price);
          remaining -= take;
          if (!remaining) break;
        }
      }
    }
  }
  match(symbol: string, book: Book) {
    this.transaction(() => {
      this.useBook(symbol, book);
      this.matchCurrent(symbol);
    });
  }

  amend(
    user: number,
    id: number,
    input: {
      quantity: number;
      limitPrice: number;
      expectedFilled: number;
      requestId: string;
    },
    book: Book,
  ) {
    return this.transaction(() => {
      const previous = this.db
        .prepare("SELECT * FROM orders WHERE user_id=? AND request_id=?")
        .get(user, input.requestId);
      if (previous) {
        if (Number(previous.replaces_id) !== id)
          throw Error("다른 주문에 사용된 요청입니다.");
        return previous;
      }
      this.expire();
      const old = this.db
        .prepare("SELECT * FROM orders WHERE id=? AND user_id=?")
        .get(id, user) as unknown as Order | undefined;
      if (!old || old.status !== "pending" || old.type !== "limit")
        throw Error("정정할 수 있는 주문이 없습니다.");
      if (old.filled_quantity !== input.expectedFilled)
        throw Error(
          "추가 체결이 발생했습니다. 최신 잔량을 확인한 후 정정해주세요.",
        );
      if (
        !Number.isSafeInteger(input.quantity) ||
        input.quantity < 1 ||
        input.quantity > old.quantity - old.filled_quantity
      )
        throw Error("정정 수량은 남은 미체결 수량 이하여야 합니다.");
      this.db
        .prepare(
          "UPDATE orders SET status='cancelled',cancel_reason='정정으로 대체' WHERE id=?",
        )
        .run(id);
      const next = this.place(
        user,
        {
          symbol: old.symbol,
          side: old.side,
          type: "limit",
          quantity: input.quantity,
          limitPrice: input.limitPrice,
          note: old.note,
          requestId: input.requestId,
          expiresAt: old.expires_at ?? undefined,
        },
        book,
      )!;
      this.db
        .prepare("UPDATE orders SET replaces_id=? WHERE id=?")
        .run(id, next.id!);
      return this.db.prepare("SELECT * FROM orders WHERE id=?").get(next.id!);
    });
  }

  cancel(user: number, id: number) {
    return this.transaction(() => {
      const r = this.db
        .prepare(
          "UPDATE orders SET status='cancelled' WHERE id=? AND user_id=? AND status='pending'",
        )
        .run(id, user);
      if (!r.changes) throw Error("취소할 수 있는 주문이 없습니다.");
    });
  }
}
