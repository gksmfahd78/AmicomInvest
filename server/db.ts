import { validatePrice } from "../src/tradingRules";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Order, User, Book, Instrument } from "../src/types";
export type TradingCosts = {
  commissionBps: number;
  sellTaxBps: number;
};
const envRate = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= 1000
    ? value
    : fallback;
};
export const configuredTradingCosts = (): TradingCosts => ({
  // 1bp = 0.01%. Rates are configurable simulation assumptions.
  commissionBps: envRate("BROKER_COMMISSION_BPS", 1.5),
  sellTaxBps: envRate("SELL_TAX_BPS", 15),
});
const charge = (value: number, bps: number) =>
  Math.floor((value * bps) / 10000);
export function competitionPerformance(
  startingAssets: number,
  startingDeposits: number,
  assets: number,
  deposits: number,
  benchmarkRate: number,
) {
  const netGrants = Math.max(0, deposits - startingDeposits);
  const rate =
    startingAssets > 0
      ? ((assets - netGrants - startingAssets) / startingAssets) * 100
      : null;
  return {
    netGrants,
    rate,
    excessRate: rate === null ? null : rate - benchmarkRate,
  };
}
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
  readonly costs: TradingCosts;
  constructor(
    path: string,
    costs = configuredTradingCosts(),
    private resolveInstrument: (symbol: string) => Instrument = () => "stock",
  ) {
    this.costs = costs;
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
    const userColumns = this.db.prepare("PRAGMA table_info(users)").all();
    if (!userColumns.some((c) => c.name === "dividends"))
      this.db.exec(
        "ALTER TABLE users ADD COLUMN dividends INTEGER NOT NULL DEFAULT 0",
      );
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
      ["instrument", "TEXT NOT NULL DEFAULT 'stock'"],
      ["expires_at", "INTEGER"],
      ["execution_reason", "TEXT"],
      ["cancel_reason", "TEXT"],
      ["replaces_id", "INTEGER"],
      ["commission_bps", "REAL NOT NULL DEFAULT 0"],
      ["sell_tax_bps", "REAL NOT NULL DEFAULT 0"],
      ["fee", "INTEGER NOT NULL DEFAULT 0"],
      ["tax", "INTEGER NOT NULL DEFAULT 0"],
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
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS corporate_actions(id INTEGER PRIMARY KEY,symbol TEXT NOT NULL,type TEXT NOT NULL,numerator INTEGER,denominator INTEGER,cash_per_share INTEGER,effective_date TEXT NOT NULL,note TEXT NOT NULL,admin_id INTEGER REFERENCES users(id),request_id TEXT NOT NULL UNIQUE,created_at TEXT DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS liquidity_recovery(symbol TEXT PRIMARY KEY,day TEXT NOT NULL,volume INTEGER NOT NULL)",
    );
    const fillColumns = this.db.prepare("PRAGMA table_info(fills)").all();
    for (const [name, definition] of [
      ["fee", "INTEGER NOT NULL DEFAULT 0"],
      ["tax", "INTEGER NOT NULL DEFAULT 0"],
      ["realized_pnl", "INTEGER NOT NULL DEFAULT 0"],
      ["cost_basis", "INTEGER NOT NULL DEFAULT 0"],
      ["book_received_at", "INTEGER"],
      ["reference_price", "INTEGER"],
      ["available_quantity", "INTEGER"],
      ["execution_note", "TEXT"],
    ])
      if (!fillColumns.some((c) => c.name === name))
        this.db.exec("ALTER TABLE fills ADD COLUMN " + name + " " + definition);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS equity_snapshots(user_id INTEGER REFERENCES users(id),bucket INTEGER NOT NULL,equity INTEGER NOT NULL,captured_at INTEGER NOT NULL,PRIMARY KEY(user_id,bucket))",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS competitions(
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        starts_at INTEGER NOT NULL,
        ends_at INTEGER NOT NULL,
        benchmark_name TEXT NOT NULL DEFAULT 'KOSPI',
        benchmark_start REAL NOT NULL,
        benchmark_end REAL,
        admin_id INTEGER REFERENCES users(id),
        request_id TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS competition_entries(
        competition_id INTEGER REFERENCES competitions(id),
        user_id INTEGER REFERENCES users(id),
        starting_assets INTEGER NOT NULL,
        starting_deposits INTEGER NOT NULL,
        ending_assets INTEGER,
        ending_deposits INTEGER,
        PRIMARY KEY(competition_id,user_id)
      );
    `);
    const competitionColumns = this.db
      .prepare("PRAGMA table_info(competitions)")
      .all();
    for (const [name, definition] of [
      ["cancelled_at", "INTEGER"],
      ["cancelled_by", "INTEGER"],
      ["cancel_reason", "TEXT"],
    ])
      if (!competitionColumns.some((column) => column.name === name))
        this.db.exec(
          "ALTER TABLE competitions ADD COLUMN " + name + " " + definition,
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
        "UPDATE orders SET status='cancelled',cancel_reason='장 마감 만료',execution_reason='주문 유효 시간이 지나 미체결 잔량을 취소했습니다.' WHERE status='pending' AND expires_at IS NOT NULL AND expires_at<=?",
      )
      .run(now);
  }
  user(id: number) {
    return this.db
      .prepare(
        "SELECT id,username,name,role,cash,deposits,realized,dividends FROM users WHERE id=?",
      )
      .get(id) as unknown as User & {
      cash: number;
      deposits: number;
      realized: number;
      dividends: number;
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
    return this.db
      .prepare(
        "SELECT quantity-filled_quantity AS quantity,limit_price,commission_bps FROM orders WHERE user_id=? AND status='pending' AND side='buy'",
      )
      .all(id)
      .reduce((sum, order) => {
        const value = Number(order.quantity) * Number(order.limit_price);
        return sum + value + charge(value, Number(order.commission_bps));
      }, 0);
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
    // A cumulative-volume advance retires at most that many simulated shares across both sides.
    // Repeated books, missing prices, falling counters and elapsed time never create liquidity.
    let recovered = 0;
    const day = sessionDay(book.receivedAt);
    if (
      book.volumeDate === day &&
      Number.isSafeInteger(book.volume) &&
      book.volume! >= 0
    ) {
      const marker = this.db
        .prepare("SELECT day,volume FROM liquidity_recovery WHERE symbol=?")
        .get(symbol);
      if (marker?.day === day && book.volume! > Number(marker.volume)) {
        let budget = book.volume! - Number(marker.volume);
        const visible = new Set([
          ...asks.map((l) => "ask:" + l.price),
          ...bids.map((l) => "bid:" + l.price),
        ]);
        for (const debt of this.db
          .prepare(
            "SELECT side,price,quantity FROM liquidity_used WHERE symbol=? AND quantity>0 ORDER BY rowid",
          )
          .all(symbol)) {
          if (!visible.has(String(debt.side) + ":" + debt.price)) continue;
          const amount = Math.min(budget, Number(debt.quantity));
          if (amount <= 0) break;
          this.db
            .prepare(
              "UPDATE liquidity_used SET quantity=quantity-? WHERE symbol=? AND side=? AND price=?",
            )
            .run(amount, symbol, debt.side!, debt.price!);
          budget -= amount;
          recovered += amount;
        }
      }
      if (!marker || marker.day !== day || book.volume! > Number(marker.volume))
        this.db
          .prepare("INSERT OR REPLACE INTO liquidity_recovery VALUES(?,?,?)")
          .run(symbol, day, book.volume!);
    }
    if (!old || old.snapshot !== snapshot || newDay || recovered > 0) {
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
  instrument(symbol: string): Instrument {
    // Keep the server-issued classification when an order is amended or the catalog changes.
    const previous = this.db
      .prepare(
        "SELECT instrument FROM orders WHERE symbol=? ORDER BY id DESC LIMIT 1",
      )
      .get(symbol);
    return previous
      ? previous.instrument === "etf"
        ? "etf"
        : "stock"
      : this.resolveInstrument(symbol);
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
      const instrument = this.instrument(symbol);
      if (input.type === "limit") validatePrice(input.limitPrice!, instrument);
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
      if (side === "buy")
        required += charge(required, this.costs.commissionBps);
      if (!Number.isSafeInteger(required))
        throw Error("주문 금액 한도를 초과했습니다.");
      if (
        side === "buy" &&
        this.user(user).cash - this.reservedCash(user) < required
      )
        throw Error("주문 가능한 현금이 부족합니다.");
      const result = this.db
        .prepare(
          "INSERT INTO orders(user_id,symbol,side,type,quantity,limit_price,status,note,request_id,commission_bps,sell_tax_bps,instrument) VALUES(?,?,?,?,?,?,'pending',?,?,?,?,?)",
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
          this.costs.commissionBps,
          instrument === "etf" ? 0 : this.costs.sellTaxBps,
          instrument,
        );
      const id = Number(result.lastInsertRowid);
      this.db
        .prepare("UPDATE orders SET expires_at=? WHERE id=?")
        .run(input.expiresAt ?? null, id);
      this.matchCurrent(symbol);
      if (type === "market")
        this.db
          .prepare(
            "UPDATE orders SET status='cancelled',cancel_reason='시장가 미체결 잔량 취소',execution_reason='현재 모의 잔량까지 체결하고 시장가 미체결 수량은 취소했습니다.' WHERE id=? AND status='pending'",
          )
          .run(id);
      return this.db.prepare("SELECT * FROM orders WHERE id=?").get(id);
    });
  }
  private fill(
    orderId: number,
    quantity: number,
    price: number,
    evidence: {
      at: number;
      reference: number;
      available: number;
      note: string;
    },
  ) {
    const o = this.db
      .prepare("SELECT * FROM orders WHERE id=?")
      .get(orderId) as unknown as Order & { user_id: number };
    const total = quantity * price;
    const fee = charge(total, Number(o.commission_bps ?? 0));
    const tax =
      o.side === "sell" ? charge(total, Number(o.sell_tax_bps ?? 0)) : 0;
    let costBasis = 0;
    let realizedPnl = 0;
    if (o.side === "buy") {
      this.db
        .prepare("UPDATE users SET cash=cash-? WHERE id=?")
        .run(total + fee, o.user_id);
      this.db
        .prepare(
          "INSERT INTO holdings(user_id,symbol,quantity,cost) VALUES(?,?,?,?) ON CONFLICT(user_id,symbol) DO UPDATE SET quantity=quantity+excluded.quantity,cost=cost+excluded.cost",
        )
        .run(o.user_id, o.symbol, quantity, total + fee);
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
      costBasis = removed;
      realizedPnl = total - fee - tax - removed;
      this.db
        .prepare("UPDATE users SET cash=cash+?,realized=realized+? WHERE id=?")
        .run(total - fee - tax, total - fee - tax - removed, o.user_id);
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
        "UPDATE orders SET filled_quantity=?,filled_value=?,fill_price=?,fee=fee+?,tax=tax+?,status=? WHERE id=?",
      )
      .run(
        filled,
        value,
        value / filled,
        fee,
        tax,
        filled === o.quantity ? "filled" : "pending",
        orderId,
      );
    this.db
      .prepare(
        "INSERT INTO fills(order_id,quantity,price,fee,tax,realized_pnl,cost_basis,book_received_at,reference_price,available_quantity,execution_note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        orderId,
        quantity,
        price,
        fee,
        tax,
        realizedPnl,
        costBasis,
        evidence.at,
        evidence.reference,
        evidence.available,
        evidence.note,
      );
  }
  private matchCurrent(symbol: string) {
    this.expire();
    const observed = this.db
      .prepare("SELECT received_at,snapshot FROM book_state WHERE symbol=?")
      .get(symbol)!;
    const original = JSON.parse(String(observed.snapshot)) as Pick<
      Book,
      "asks" | "bids"
    >;
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
          if (o.type === "market" && side === "buy") {
            const available =
              this.user(o.user_id).cash - this.reservedCash(o.user_id);
            take = Math.min(take, Math.floor(available / price));
            while (
              take > 0 &&
              take * price +
                charge(take * price, Number(o.commission_bps ?? 0)) >
                available
            )
              take--;
          }
          if (take <= 0) break;
          this.fill(o.id, take, price, {
            at: Number(observed.received_at),
            reference:
              (side === "buy" ? original.asks : original.bids)[0]?.price ??
              price,
            available: Number(l.quantity),
            note:
              (side === "buy" ? "낮은 매도호가" : "높은 매수호가") +
              "부터 가격·접수 순으로 배분했습니다. " +
              (o.type === "limit"
                ? "지정가 조건을 충족한 호가입니다. "
                : "시장가 주문으로 상대 호가를 순서대로 사용했습니다. ") +
              "이 가격의 배분 전 모의 잔량 " +
              Number(l.quantity).toLocaleString("ko-KR") +
              "주 중 " +
              take.toLocaleString("ko-KR") +
              "주를 체결했습니다.",
          });
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
        const withinLimit = (
          side === "buy" ? original.asks : original.bids
        ).some(
          (l) =>
            o.type === "market" ||
            (side === "buy"
              ? l.price <= o.limit_price!
              : l.price >= o.limit_price!),
        );
        const reason =
          remaining === 0
            ? "주문 수량을 가격·접수 순으로 모의 체결했습니다."
            : withinLimit
              ? "가격 조건 안의 모의 잔량을 기다립니다. 앞선 주문에 배분되었거나 현재 잔량이 부족합니다."
              : "지정가 조건에 맞는 상대 호가를 기다립니다.";
        this.db
          .prepare("UPDATE orders SET execution_reason=? WHERE id=?")
          .run(reason, o.id);
      }
    }
  }
  defer(symbol: string, reason: string) {
    this.db
      .prepare(
        "UPDATE orders SET execution_reason=? WHERE symbol=? AND status='pending'",
      )
      .run(reason.slice(0, 500), symbol);
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
          "UPDATE orders SET status='cancelled',cancel_reason='정정으로 대체',execution_reason='미체결 잔량을 정정 주문으로 대체했습니다.' WHERE id=?",
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

  recordEquity(user: number, equity: number, now = Date.now()) {
    if (!Number.isSafeInteger(equity) || equity < 0) return;
    const bucket = Math.floor(now / 300000);
    this.db
      .prepare(
        "INSERT INTO equity_snapshots(user_id,bucket,equity,captured_at) VALUES(?,?,?,?) ON CONFLICT(user_id,bucket) DO UPDATE SET equity=excluded.equity,captured_at=excluded.captured_at",
      )
      .run(user, bucket, equity, now);
  }

  analytics(user: number) {
    const sellOrders = this.db
      .prepare(
        "SELECT o.id,SUM(f.realized_pnl) pnl FROM orders o JOIN fills f ON f.order_id=o.id WHERE o.user_id=? AND o.side='sell' GROUP BY o.id",
      )
      .all(user)
      .map((row) => Number(row.pnl));
    const wins = sellOrders.filter((pnl) => pnl > 0);
    const losses = sellOrders.filter((pnl) => pnl < 0);
    const grossProfit = wins.reduce((sum, pnl) => sum + pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, pnl) => sum + pnl, 0));
    const totals = this.db
      .prepare(
        "SELECT COUNT(DISTINCT o.id) orders,COALESCE(SUM(f.quantity*f.price),0) turnover,COALESCE(SUM(f.fee),0) fees,COALESCE(SUM(f.tax),0) taxes FROM orders o LEFT JOIN fills f ON f.order_id=o.id WHERE o.user_id=?",
      )
      .get(user);
    const notes = this.db
      .prepare(
        "SELECT COUNT(*) total,SUM(CASE WHEN trim(note)<>'' THEN 1 ELSE 0 END) noted FROM orders WHERE user_id=?",
      )
      .get(user);
    const snapshots = this.db
      .prepare(
        "SELECT equity FROM equity_snapshots WHERE user_id=? ORDER BY captured_at",
      )
      .all(user)
      .map((row) => Number(row.equity));
    let peak = 0;
    let maxDrawdown = 0;
    for (const equity of snapshots) {
      peak = Math.max(peak, equity);
      if (peak > 0) maxDrawdown = Math.min(maxDrawdown, (equity - peak) / peak);
    }
    return {
      orderCount: Number(totals?.orders ?? 0),
      sellCount: sellOrders.length,
      winRate: sellOrders.length
        ? (wins.length / sellOrders.length) * 100
        : null,
      averagePnl: sellOrders.length
        ? sellOrders.reduce((sum, pnl) => sum + pnl, 0) / sellOrders.length
        : null,
      profitFactor:
        grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
      turnover: Number(totals?.turnover ?? 0),
      fees: Number(totals?.fees ?? 0),
      taxes: Number(totals?.taxes ?? 0),
      noteRate: Number(notes?.total ?? 0)
        ? (Number(notes?.noted ?? 0) / Number(notes?.total)) * 100
        : null,
      maxDrawdown: snapshots.length > 1 ? maxDrawdown * 100 : null,
      snapshotCount: snapshots.length,
    };
  }

  createCompetition(
    admin: number,
    input: {
      name: string;
      startsAt: number;
      endsAt: number;
      benchmarkStart: number;
      requestId: string;
      entries: { userId: number; assets: number; deposits: number }[];
    },
  ) {
    return this.transaction(() => {
      const previous = this.db
        .prepare("SELECT * FROM competitions WHERE request_id=?")
        .get(input.requestId);
      if (previous) return previous;
      if (
        this.db
          .prepare("SELECT id FROM competitions WHERE status='active'")
          .get()
      )
        throw Error("이미 진행 중인 대회가 있습니다.");
      if (!input.entries.length) throw Error("참가할 멤버가 없습니다.");
      if (
        !Number.isFinite(input.benchmarkStart) ||
        input.benchmarkStart <= 0 ||
        input.endsAt <= input.startsAt
      )
        throw Error("대회 기간 또는 기준 지수를 확인해주세요.");
      const result = this.db
        .prepare(
          "INSERT INTO competitions(name,status,starts_at,ends_at,benchmark_start,admin_id,request_id) VALUES(?,'active',?,?,?,?,?)",
        )
        .run(
          input.name,
          input.startsAt,
          input.endsAt,
          input.benchmarkStart,
          admin,
          input.requestId,
        );
      const id = Number(result.lastInsertRowid);
      const insert = this.db.prepare(
        "INSERT INTO competition_entries(competition_id,user_id,starting_assets,starting_deposits) VALUES(?,?,?,?)",
      );
      for (const entry of input.entries) {
        if (
          !Number.isSafeInteger(entry.assets) ||
          entry.assets < 0 ||
          !Number.isSafeInteger(entry.deposits) ||
          entry.deposits < 0
        )
          throw Error("참가자 기준 자산이 올바르지 않습니다.");
        insert.run(id, entry.userId, entry.assets, entry.deposits);
      }
      return this.db.prepare("SELECT * FROM competitions WHERE id=?").get(id);
    });
  }

  cancelCompetition(admin: number, competitionId: number, reason: string) {
    return this.transaction(() => {
      const competition = this.db
        .prepare("SELECT * FROM competitions WHERE id=?")
        .get(competitionId);
      if (!competition) throw Error("대회를 찾을 수 없습니다.");
      if (competition.status === "cancelled") return competition;
      if (competition.status !== "active")
        throw Error("진행 중인 대회만 취소할 수 있습니다.");
      const cleanReason = reason.trim();
      if (!cleanReason || cleanReason.length > 200)
        throw Error("취소 사유를 1~200자로 입력해주세요.");
      this.db
        .prepare(
          "UPDATE competitions SET status='cancelled',cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=? AND status='active'",
        )
        .run(Date.now(), admin, cleanReason, competitionId);
      return this.db
        .prepare("SELECT * FROM competitions WHERE id=?")
        .get(competitionId);
    });
  }

  finishCompetition(
    competitionId: number,
    benchmarkEnd: number,
    entries: { userId: number; assets: number; deposits: number }[],
  ) {
    return this.transaction(() => {
      const competition = this.db
        .prepare("SELECT * FROM competitions WHERE id=?")
        .get(competitionId);
      if (!competition) throw Error("대회를 찾을 수 없습니다.");
      if (competition.status === "ended") return competition;
      if (competition.status !== "active")
        throw Error("진행 중인 대회만 종료할 수 있습니다.");
      if (!Number.isFinite(benchmarkEnd) || benchmarkEnd <= 0)
        throw Error("종료 기준 지수가 올바르지 않습니다.");
      const expected = Number(
        this.db
          .prepare(
            "SELECT COUNT(*) count FROM competition_entries WHERE competition_id=?",
          )
          .get(competitionId)!.count,
      );
      if (entries.length !== expected)
        throw Error("모든 참가자의 종료 자산이 필요합니다.");
      const update = this.db.prepare(
        "UPDATE competition_entries SET ending_assets=?,ending_deposits=? WHERE competition_id=? AND user_id=?",
      );
      for (const entry of entries) {
        if (!Number.isSafeInteger(entry.assets) || entry.assets < 0)
          throw Error("종료 자산이 올바르지 않습니다.");
        update.run(entry.assets, entry.deposits, competitionId, entry.userId);
      }
      this.db
        .prepare(
          "UPDATE competitions SET status='ended',benchmark_end=? WHERE id=?",
        )
        .run(benchmarkEnd, competitionId);
      return this.db
        .prepare("SELECT * FROM competitions WHERE id=?")
        .get(competitionId);
    });
  }

  competitions() {
    return this.db
      .prepare(
        "SELECT c.*,COUNT(e.user_id) participant_count FROM competitions c LEFT JOIN competition_entries e ON e.competition_id=c.id GROUP BY c.id ORDER BY c.id DESC",
      )
      .all();
  }

  competitionEntries(id: number) {
    return this.db
      .prepare(
        "SELECT e.*,u.name,u.cash,u.deposits FROM competition_entries e JOIN users u ON u.id=e.user_id WHERE e.competition_id=? ORDER BY e.user_id",
      )
      .all(id);
  }

  applyCorporateAction(
    admin: number,
    input: {
      symbol: string;
      type: "dividend" | "split";
      numerator?: number;
      denominator?: number;
      cashPerShare?: number;
      effectiveDate: string;
      note: string;
      requestId: string;
    },
  ) {
    return this.transaction(() => {
      const previous = this.db
        .prepare("SELECT * FROM corporate_actions WHERE request_id=?")
        .get(input.requestId);
      if (previous) return previous;
      if (input.type === "dividend") {
        const amount = Number(input.cashPerShare);
        if (!Number.isSafeInteger(amount) || amount < 0 || amount > 10000000)
          throw Error("주당 배당금은 0원~1천만 원이어야 합니다.");
        for (const holding of this.db
          .prepare(
            "SELECT user_id,quantity FROM holdings WHERE symbol=? AND quantity>0",
          )
          .all(input.symbol)) {
          const paid = Number(holding.quantity) * amount;
          if (!Number.isSafeInteger(paid))
            throw Error("배당 금액 한도를 초과했습니다.");
          this.db
            .prepare(
              "UPDATE users SET cash=cash+?,dividends=dividends+? WHERE id=?",
            )
            .run(paid, paid, holding.user_id);
        }
      } else {
        const numerator = Number(input.numerator);
        const denominator = Number(input.denominator);
        if (
          !Number.isSafeInteger(numerator) ||
          !Number.isSafeInteger(denominator) ||
          numerator < 1 ||
          denominator < 1 ||
          numerator > 1000 ||
          denominator > 1000 ||
          numerator === denominator
        )
          throw Error("분할 비율을 확인해주세요.");
        const holdings = this.db
          .prepare("SELECT user_id,quantity FROM holdings WHERE symbol=?")
          .all(input.symbol);
        if (
          holdings.some(
            (holding) =>
              (Number(holding.quantity) * numerator) % denominator !== 0,
          )
        )
          throw Error("단주가 발생하는 계좌가 있어 분할을 적용할 수 없습니다.");
        for (const holding of holdings)
          this.db
            .prepare(
              "UPDATE holdings SET quantity=? WHERE user_id=? AND symbol=?",
            )
            .run(
              (Number(holding.quantity) * numerator) / denominator,
              holding.user_id,
              input.symbol,
            );
        this.db
          .prepare(
            "UPDATE orders SET status='cancelled',cancel_reason='기업행사로 취소',execution_reason='기업행사 반영으로 미체결 잔량을 취소했습니다.' WHERE symbol=? AND status='pending'",
          )
          .run(input.symbol);
        this.db
          .prepare("DELETE FROM book_state WHERE symbol=?")
          .run(input.symbol);
        this.db
          .prepare("DELETE FROM liquidity WHERE symbol=?")
          .run(input.symbol);
        this.db
          .prepare("DELETE FROM liquidity_used WHERE symbol=?")
          .run(input.symbol);
      }
      const result = this.db
        .prepare(
          "INSERT INTO corporate_actions(symbol,type,numerator,denominator,cash_per_share,effective_date,note,admin_id,request_id) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          input.symbol,
          input.type,
          input.type === "split" ? (input.numerator ?? null) : null,
          input.type === "split" ? (input.denominator ?? null) : null,
          input.type === "dividend" ? (input.cashPerShare ?? null) : null,
          input.effectiveDate,
          input.note,
          admin,
          input.requestId,
        );
      return this.db
        .prepare("SELECT * FROM corporate_actions WHERE id=?")
        .get(result.lastInsertRowid);
    });
  }

  cancel(user: number, id: number) {
    return this.transaction(() => {
      const r = this.db
        .prepare(
          "UPDATE orders SET status='cancelled',execution_reason='사용자가 미체결 잔량을 취소했습니다.' WHERE id=? AND user_id=? AND status='pending'",
        )
        .run(id, user);
      if (!r.changes) throw Error("취소할 수 있는 주문이 없습니다.");
    });
  }
}
