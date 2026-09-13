import { kis, provider } from "./market";
import {
  activeVi,
  bookState,
  clockState,
  state,
  type ExecutionState,
} from "../src/executionRules";
import type { Book } from "../src/types";
import { realtime } from "./realtime";
import { koreaDate, validatePrice } from "../src/tradingRules";
import type { Store } from "./db";
export class TradingRules {
  private calendar?: Promise<boolean>;
  private statuses = new Map<
    string,
    {
      at: number;
      day: string;
      halted: boolean;
      vi: boolean;
      lower: number;
      upper: number;
    }
  >();
  private loading = new Map<string, Promise<void>>();
  private now: () => number;
  private source: string;
  private fetch: typeof kis;
  constructor(
    private store: Store,
    options: { now?: () => number; provider?: string; fetch?: typeof kis } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.source = options.provider ?? provider;
    this.fetch = options.fetch ?? kis;
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS trading_calendar(day TEXT PRIMARY KEY,is_open INTEGER NOT NULL)",
    );
  }
  private async isOpen() {
    const day = koreaDate(this.now()).replaceAll("-", "");
    const cached = this.store.db
      .prepare("SELECT is_open FROM trading_calendar WHERE day=?")
      .get(day);
    if (cached) return Boolean(cached.is_open);
    if (this.calendar) return this.calendar;
    this.calendar = (async () => {
      const d = await this.fetch("chk-holiday", "CTCA0903R", {
        BASS_DT: day,
        CTX_AREA_FK: "",
        CTX_AREA_NK: "",
      });
      const row = d.output?.find(
        (r: Record<string, string>) => r.bass_dt === day,
      );
      if (!row || !["Y", "N"].includes(row.opnd_yn))
        throw Error("거래일 확인에 실패해 주문을 보류합니다.");
      this.store.db
        .prepare("INSERT OR REPLACE INTO trading_calendar VALUES(?,?)")
        .run(day, row.opnd_yn === "Y" ? 1 : 0);
      return row.opnd_yn === "Y";
    })().finally(() => {
      this.calendar = undefined;
    });
    return this.calendar;
  }
  private async load(symbol: string) {
    const day = koreaDate(this.now()).replaceAll("-", "");
    const old = this.statuses.get(symbol);
    if (old && old.day === day && this.now() - old.at < 3000) return;
    if (this.loading.has(symbol)) return this.loading.get(symbol);
    const pending = (async () => {
      const [price, vi] = await Promise.all([
        this.fetch("inquire-price", "FHKST01010100", {
          FID_COND_MRKT_DIV_CODE: "J",
          FID_INPUT_ISCD: symbol,
        }),
        this.fetch("inquire-vi-status", "FHPST01390000", {
          FID_DIV_CLS_CODE: "0",
          FID_COND_SCR_DIV_CODE: "20139",
          FID_MRKT_CLS_CODE: "0",
          FID_INPUT_ISCD: symbol,
          FID_RANK_SORT_CLS_CODE: "0",
          FID_INPUT_DATE_1: day,
          FID_TRGT_CLS_CODE: "0",
          FID_TRGT_EXLS_CLS_CODE: "",
        }),
      ]);
      const d = price.output;
      if (!d || !["Y", "N"].includes(d.temp_stop_yn))
        throw Error("거래 정지 여부를 확인할 수 없습니다.");
      this.statuses.set(symbol, {
        at: this.now(),
        day,
        halted: d.temp_stop_yn === "Y",
        vi: activeVi(vi.output, symbol, day),
        lower: Number(d.stck_llam),
        upper: Number(d.stck_mxpr),
      });
    })().finally(() => this.loading.delete(symbol));
    this.loading.set(symbol, pending);
    return pending;
  }
  async inspect(symbol: string, book: Book): Promise<ExecutionState> {
    if (this.source === "demo")
      return state(
        "demo",
        "데모 체결 · 가격 조건과 모의 잔량을 적용합니다.",
        this.now(),
      );
    const boundary = clockState(this.now());
    if (boundary) return boundary;
    try {
      if (!(await this.isOpen()))
        return state("holiday", "오늘은 휴장일입니다.", this.now());
      await this.load(symbol);
      const status = this.statuses.get(symbol)!;
      const live = realtime.quotes.get(symbol);
      if (
        status.halted ||
        (live?.halted && this.now() - live.receivedAt < 10000)
      )
        return state(
          "halted",
          "거래 정지 종목입니다. 해제 확인 전까지 체결을 보류합니다.",
          this.now(),
        );
      if (status.vi)
        return state(
          "vi",
          "VI 발동 중입니다. 제공처에서 해제가 확인될 때까지 체결을 보류합니다.",
          this.now(),
        );
      return bookState(book, this.now());
    } catch {
      return state(
        "unknown",
        "거래일·거래 정지·VI 상태를 확인하지 못해 체결을 보류합니다. 잠시 후 다시 확인해주세요.",
        this.now(),
      );
    }
  }
  async check(symbol: string, price: number | undefined, book: Book) {
    if (price !== undefined)
      validatePrice(price, this.store.instrument(symbol));
    const current = await this.inspect(symbol, book);
    if (!current.canTrade) throw Error(current.reason);
    if (this.source === "demo") return;
    const status = this.statuses.get(symbol)!;
    if (
      price !== undefined &&
      (!(status.lower > 0) || !(status.upper >= status.lower))
    )
      throw Error("가격 제한 범위를 확인할 수 없습니다.");
    if (price !== undefined && (price < status.lower || price > status.upper))
      throw Error("주문 가격은 하한가~상한가 범위여야 합니다.");
  }
}
