import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "./db";
import { AccountValuator, PerformanceStore } from "./performance";
import { JournalStore } from "./journal";
import { portfolioRisk, projectedWeight } from "../src/portfolioRisk";
import type { Account, Book, Quote, Stock } from "../src/types";

function setup() {
  const store = new Store(":memory:", { commissionBps: 0, sellTaxBps: 0 });
  const user = store.createUser("learning", "학습", "password123");
  store.grant(user.id, user.id, 1000000, "초기 투자금", randomUUID());
  return { store, user, performance: new PerformanceStore(store) };
}
const quote = (price: number, receivedAt = Date.now()): Quote => ({
  symbol: "005930",
  price,
  receivedAt,
  source: "demo",
  change: 0,
  changeRate: 0,
  high: price,
  low: price,
  open: price,
  volume: 100,
});
const book: () => Book = () => ({
  receivedAt: Date.now(),
  asks: [{ price: 10000, quantity: 100 }],
  bids: [{ price: 9900, quantity: 100 }],
});
const input = () => ({
  symbol: "005930",
  side: "buy" as const,
  type: "limit" as const,
  limitPrice: 9000,
  quantity: 1,
  note: "실적 관찰",
  requestId: randomUUID(),
});

test("추가 지급은 수익률과 낙폭을 회복시키지 않고 이후 수익률만 연결한다", () => {
  const { store, user, performance: p } = setup();
  try {
    p.record(user.id, 1000000, 0, "scheduled", { kospi: 2500, kosdaq: 800 });
    p.record(user.id, 900000, 300000, "flow_before", {
      kospi: 2450,
      kosdaq: 790,
    });
    store.grant(user.id, user.id, 1000000, "추가 지급", randomUUID());
    p.record(user.id, 1900000, 300000, "flow_after", {
      kospi: 2450,
      kosdaq: 790,
    });
    p.record(user.id, 2090000, 600000, "scheduled", {
      kospi: 2525,
      kosdaq: 808,
    });
    const r = p.report(user.id);
    assert.ok(Math.abs(r.rate! - -1) < 1e-10);
    assert.ok(Math.abs(r.maxDrawdown! - -10) < 1e-10);
    assert.equal(r.profit, 90000);
    assert.equal(r.netGrants, 1000000);
    assert.ok(Math.abs(r.kospi! - 1) < 1e-10);
    assert.ok(Math.abs(r.kosdaq! - 1) < 1e-10);
    assert.equal(r.flowGap, false);
    assert.equal(r.periods[0].profit, 90000);
    assert.equal(r.periods[0].netGrants, 1000000);
  } finally {
    store.db.close();
  }
});

test("같은 5분 구간의 중복 수집은 기준 기록을 덮어쓰지 않는다", () => {
  const { store, user, performance: p } = setup();
  try {
    p.record(user.id, 1000000, 0);
    p.record(user.id, 900000, 1000);
    assert.equal(p.report(user.id).count, 1);
    assert.equal(p.report(user.id).points[0].equity, 1000000);
    assert.equal(p.report(user.id).rate, null);
  } finally {
    store.db.close();
  }
});

test("지급 전후 평가 누락은 수익률을 추정하지 않고 금액 손익만 제공한다", () => {
  const { store, user, performance: p } = setup();
  try {
    p.record(user.id, 1000000, 0);
    store.grant(user.id, user.id, 1000000, "평가 누락 지급", randomUUID());
    p.record(user.id, 1900000, 300000);
    const r = p.report(user.id);
    assert.equal(r.flowGap, true);
    assert.equal(r.rate, null);
    assert.equal(r.maxDrawdown, null);
    assert.equal(r.profit, -100000);
    assert.ok(r.points.every((p) => p.rate === null));
  } finally {
    store.db.close();
  }
});

test("최신 시세가 없는 계좌는 원가나 0원으로 평가하지 않는다", async () => {
  const { store, user, performance: p } = setup();
  try {
    store.db
      .prepare("INSERT INTO holdings VALUES(?,?,?,?)")
      .run(user.id, "005930", 10, 100000);
    assert.throws(() => p.value(user.id, new Map()), /최신 시세/);
    assert.throws(
      () =>
        p.value(
          user.id,
          new Map([["005930", quote(11000, Date.now() - 61000)]]),
        ),
      /최신 시세/,
    );
    const collector = new AccountValuator(
      store,
      p,
      async () => {
        throw Error("offline");
      },
      async () => ({ kospi: null, kosdaq: null }),
    );
    await collector.collect();
    assert.equal(p.report(user.id).count, 0);
  } finally {
    store.db.close();
  }
});

test("화면 조회 없이 모든 계좌를 수집하고 공유 종목은 한 번만 조회한다", async () => {
  const { store, user, performance: p } = setup();
  try {
    const other = store.createUser("another", "다른 회원", "password123");
    for (const id of [user.id, other.id])
      store.db
        .prepare("INSERT INTO holdings VALUES(?,?,?,?)")
        .run(id, "005930", 1, 10000);
    let calls = 0;
    const collector = new AccountValuator(
      store,
      p,
      async () => {
        calls++;
        return quote(12000);
      },
      async () => ({ kospi: 2500, kosdaq: 800 }),
    );
    await Promise.all([collector.collect(), collector.collect()]);
    assert.equal(calls, 1);
    assert.equal(p.report(user.id).count, 1);
    assert.equal(p.report(other.id).points[0].equity, 12000);
  } finally {
    store.db.close();
  }
});

test("시세 조회 중 계좌가 바뀌면 최신 잔고로 평가한다", async () => {
  const { store, user, performance: p } = setup();
  try {
    store.db
      .prepare("INSERT INTO holdings VALUES(?,?,?,?)")
      .run(user.id, "005930", 1, 10000);
    const collector = new AccountValuator(
      store,
      p,
      async () => {
        store.db
          .prepare("UPDATE users SET cash=900000 WHERE id=?")
          .run(user.id);
        store.db
          .prepare("UPDATE holdings SET quantity=10 WHERE user_id=?")
          .run(user.id);
        return quote(10000);
      },
      async () => ({ kospi: null, kosdaq: null }),
    );
    await collector.collect();
    assert.equal(p.report(user.id).points[0].equity, 1000000);
  } finally {
    store.db.close();
  }
});

test("수집 시작 이전의 기존 평가 기록은 새 성과에 섞지 않는다", () => {
  const { store, user, performance: p } = setup();
  try {
    store.recordEquity(user.id, 1000000, 0);
    store.recordEquity(user.id, 500000, 300000);
    assert.equal(p.report(user.id).count, 0);
    p.record(user.id, 500000, 600000);
    assert.equal(p.report(user.id).rate, null);
  } finally {
    store.db.close();
  }
});

test("일지는 계획을 보존하고 소유권과 수정 충돌을 검사한다", () => {
  const { store, user } = setup();
  try {
    const journal = new JournalStore(store),
      order = store.place(user.id, input(), book())!;
    const plan = {
      horizon: "한 달",
      invalidation: "영업이익 감소",
      source: "분기 보고서",
    };
    journal.capture(user.id, Number(order.id), plan, book());
    journal.capture(
      user.id,
      Number(order.id),
      { ...plan, horizon: "변조" },
      book(),
    );
    assert.equal(journal.list(user.id).entries[0].plan.horizon, "한 달");
    const review = {
      reason: "계획대로 관찰",
      lesson: "공시를 먼저 확인",
      adherence: "followed" as const,
    };
    const other = store.createUser("outsider", "타인", "password123");
    assert.throws(
      () => journal.save(other.id, Number(order.id), 0, review),
      /주문을 찾을 수/,
    );
    assert.equal(journal.list(other.id).total, 0);
    assert.equal(
      journal.save(user.id, Number(order.id), 0, review).revision,
      1,
    );
    assert.equal(
      journal.save(user.id, Number(order.id), 0, review).revision,
      1,
    );
    assert.throws(
      () =>
        journal.save(user.id, Number(order.id), 0, {
          ...review,
          lesson: "동시 변경",
        }),
      /다른 화면/,
    );
    assert.equal(journal.list(user.id, "", 0, "reviewed").total, 1);
    assert.equal(journal.list(user.id, "", 0, "unreviewed").total, 0);
    assert.deepEqual(journal.list(user.id).entries[0].plan, plan);
    assert.throws(
      () =>
        journal.save(user.id, Number(order.id), 1, { ...review, lesson: "" }),
      /작성해주세요/,
    );
  } finally {
    store.db.close();
  }
});

test("기존 주문도 복기하며 정정 주문은 최초 계획을 이어받는다", () => {
  const { store, user } = setup();
  try {
    const journal = new JournalStore(store),
      order = store.place(user.id, input(), book())!;
    const before = journal.list(user.id).entries[0];
    assert.equal(before.note, "실적 관찰");
    assert.equal(before.context, null);
    journal.save(user.id, Number(order.id), 0, {
      reason: "",
      lesson: "",
      adherence: "unreviewed",
    });
    const original = store.place(user.id, input(), book())!;
    journal.capture(
      user.id,
      Number(original.id),
      { horizon: "다음 분기", source: "공시", invalidation: "매출 감소" },
      book(),
    );
    const amended = store.amend(
      user.id,
      Number(original.id),
      {
        quantity: 1,
        limitPrice: 8000,
        expectedFilled: 0,
        requestId: randomUUID(),
      },
      book(),
    )!;
    journal.capture(
      user.id,
      Number(amended.id),
      { horizon: "", source: "", invalidation: "" },
      book(),
      Number(original.id),
    );
    assert.equal(journal.list(user.id).entries[0].plan.horizon, "다음 분기");
    assert.equal(
      journal.list(user.id).entries[0].replaces_id,
      Number(original.id),
    );
  } finally {
    store.db.close();
  }
});

const account: Account = {
  cash: 500000,
  available: 500000,
  deposits: 1000000,
  realized: 0,
  dividends: 0,
  orders: [],
  holdings: [
    {
      symbol: "005930",
      name: "삼성전자",
      quantity: 20,
      cost: 200000,
      price: 10000,
      reserved: 0,
    },
    {
      symbol: "000660",
      name: "SK하이닉스",
      quantity: 30,
      cost: 300000,
      price: 10000,
      reserved: 0,
    },
  ],
};
const stocks: Stock[] = account.holdings.map((h) => ({
  symbol: h.symbol,
  name: h.name,
  sector: "주식",
  market: "KOSPI",
  base: 10000,
}));
test("비중은 현금을 포함하고 중복 테마와 업종 미분류를 구별한다", () => {
  const risk = portfolioRisk(account, stocks, [
    { code: "001", name: "반도체", symbols: ["005930", "000660"] },
    { code: "002", name: "AI", symbols: ["000660", "000660"] },
  ]);
  assert.ok(risk.complete);
  assert.equal(risk.total, 1000000);
  assert.equal(risk.cashWeight, 50);
  assert.equal(risk.positions[0].weight, 30);
  assert.deepEqual(
    risk.exposures.map((e) => e.weight),
    [50, 30],
  );
  assert.deepEqual(risk.industries, [{ name: "업종 미분류", weight: 50 }]);
  assert.equal(
    portfolioRisk(
      { ...account, holdings: [{ ...account.holdings[0], price: null }] },
      stocks,
      [],
    ).complete,
    false,
  );
});
test("주문 후 비중은 매수·매도와 비용을 반영하고 불가능한 주문은 안내하지 않는다", () => {
  assert.equal(
    projectedWeight(account, "005930", "buy", 10, 10000, 0, 0, 10000),
    30,
  );
  assert.equal(
    projectedWeight(account, "005930", "sell", 10, 10000, 0, 0, 10000),
    10,
  );
  assert.ok(
    projectedWeight(account, "005930", "buy", 10, 10000, 10, 0, 10000)! > 30,
  );
  assert.equal(
    projectedWeight(account, "005930", "sell", 30, 10000, 0, 0, 10000),
    null,
  );
  assert.equal(
    projectedWeight(account, "005930", "buy", 100, 10000, 0, 0, 10000),
    null,
  );
});

test("일지는 최근 200건 제한 없이 종목별 페이지를 조회한다", () => {
  const { store, user } = setup();
  try {
    const journal = new JournalStore(store);
    const insert = store.db.prepare(
      "INSERT INTO orders(user_id,symbol,side,type,quantity,status,note,request_id) VALUES(?,?,'buy','limit',1,'cancelled',?,?)",
    );
    store.transaction(() => {
      for (let i = 0; i < 205; i++)
        insert.run(user.id, "005930", `과거 주문 ${i}`, randomUUID());
      insert.run(user.id, "000660", "다른 종목", randomUUID());
    });
    assert.equal(journal.list(user.id).total, 206);
    const last = journal.list(user.id, "005930", 10);
    assert.equal(last.total, 205);
    assert.equal(last.entries.length, 5);
    assert.equal(last.entries.at(-1)!.note, "과거 주문 0");
  } finally {
    store.db.close();
  }
});

test("KST 일·주·월 집계와 조회 기간은 실제 관측 시작점을 사용한다", () => {
  const { store, user, performance: p } = setup();
  try {
    const start = Date.parse("2026-08-31T06:00:00Z");
    p.record(user.id, 1000000, start);
    p.record(user.id, 1100000, start + 86400000);
    p.record(user.id, 990000, start + 2 * 86400000);
    assert.deepEqual(
      p.report(user.id, "all", "day").periods.map((x) => [x.label, x.profit]),
      [
        ["2026-09-02", -110000],
        ["2026-09-01", 100000],
      ],
    );
    assert.equal(
      p.report(user.id, "all", "week").periods[0].label,
      "2026-08-31",
    );
    assert.equal(p.report(user.id, "all", "month").periods[0].profit, -10000);
    const recent = p.report(user.id, "day", "day", start + 2 * 86400000);
    assert.equal(recent.startedAt, start + 86400000);
    assert.ok(Math.abs(recent.rate! + 10) < 1e-10);
    new PerformanceStore(store);
    assert.equal(p.report(user.id).count, 3);
  } finally {
    store.db.close();
  }
});
