import { kis, provider, regularHours } from "./market";
import { realtime } from "./realtime";
import { koreaDate, validatePrice } from "../src/tradingRules";
import type { Store } from "./db";
export class TradingRules {
  private calendar?: Promise<boolean>;
  private statuses = new Map<
    string,
    { at: number; halted: boolean; lower: number; upper: number }
  >();
  constructor(private store: Store) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS trading_calendar(day TEXT PRIMARY KEY,is_open INTEGER NOT NULL)",
    );
  }
  private async isOpen() {
    const day = koreaDate().replaceAll("-", "");
    const cached = this.store.db
      .prepare("SELECT is_open FROM trading_calendar WHERE day=?")
      .get(day);
    if (cached) return Boolean(cached.is_open);
    if (this.calendar) return this.calendar;
    this.calendar = (async () => {
      const d = await kis("chk-holiday", "CTCA0903R", {
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
  async check(symbol: string, price?: number) {
    if (price !== undefined) validatePrice(price);
    if (provider === "demo") return;
    if (!regularHours())
      throw Error("모의 주문은 정규장 09:00~15:30에 가능합니다.");
    if (!(await this.isOpen())) throw Error("오늘은 휴장일입니다.");
    let status = this.statuses.get(symbol);
    if (!status || Date.now() - status.at > 10000) {
      const d = (
        await kis("inquire-price", "FHKST01010100", {
          FID_COND_MRKT_DIV_CODE: "J",
          FID_INPUT_ISCD: symbol,
        })
      ).output;
      if (!d || !["Y", "N"].includes(d.temp_stop_yn))
        throw Error("종목 거래 상태를 확인할 수 없습니다.");
      status = {
        at: Date.now(),
        halted: d.temp_stop_yn === "Y",
        lower: Number(d.stck_llam),
        upper: Number(d.stck_mxpr),
      };
      this.statuses.set(symbol, status);
    }
    if (status.halted || realtime.quotes.get(symbol)?.halted)
      throw Error("거래 정지 종목은 체결을 보류합니다.");
    if (
      price !== undefined &&
      (!(status.lower > 0) || !(status.upper >= status.lower))
    )
      throw Error("가격 제한 범위를 확인할 수 없습니다.");
    if (price !== undefined && (price < status.lower || price > status.upper))
      throw Error("주문 가격은 하한가~상한가 범위여야 합니다.");
  }
}
