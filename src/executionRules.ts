import type { Book } from "./types";
export type ExecutionState = {
  phase:
    | "demo"
    | "continuous"
    | "opening_auction"
    | "closing_auction"
    | "off_hours"
    | "holiday"
    | "vi"
    | "halted"
    | "unknown";
  canTrade: boolean;
  reason: string;
  checkedAt: number;
};
export function state(
  phase: ExecutionState["phase"],
  reason: string,
  checkedAt: number,
): ExecutionState {
  return {
    phase,
    reason,
    checkedAt,
    canTrade: phase === "continuous" || phase === "demo",
  };
}
export function clockState(now = Date.now()): ExecutionState | null {
  const kst = new Date(now + 9 * 3600000),
    minute = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if ([0, 6].includes(kst.getUTCDay()))
    return state("holiday", "휴장일에는 모의 체결을 진행하지 않습니다.", now);
  if (minute >= 510 && minute < 540)
    return state(
      "opening_auction",
      "시가 단일가 구간입니다. 일반 거래가 확인되면 주문할 수 있습니다.",
      now,
    );
  if (minute >= 920 && minute < 930)
    return state(
      "closing_auction",
      "종가 단일가 구간입니다. 모의 체결을 보류하며 미체결 주문은 15:30에 만료됩니다.",
      now,
    );
  if (minute < 540 || minute >= 930)
    return state(
      "off_hours",
      "장 운영 시간 밖입니다. 일반 거래 구간 09:00~15:20에 모의 주문할 수 있습니다.",
      now,
    );
  return null;
}
/** Use both boundaries and provider state; do not turn auction books into continuous fills. */
export function bookState(book: Book, now = Date.now()): ExecutionState {
  const boundary = clockState(now);
  if (boundary) return boundary;
  if (
    !Number.isFinite(book.receivedAt) ||
    now - book.receivedAt > 20000 ||
    book.receivedAt > now + 1000
  )
    return state("unknown", "호가가 오래되어 체결을 보류합니다.", now);
  if (book.session !== undefined && book.session !== "0")
    return state(
      "unknown",
      "일반 거래 호가가 아닙니다. 단일가·시간외 구간의 체결을 보류합니다.",
      now,
    );
  if (book.marketPhase !== undefined && book.marketPhase !== "20")
    return state(
      "unknown",
      "제공처의 장 운영 상태가 일반 거래가 아니어서 체결을 보류합니다.",
      now,
    );
  if (book.session !== "0" && book.marketPhase !== "20")
    return state(
      "unknown",
      "호가의 거래 상태를 확인할 수 없어 체결을 보류합니다.",
      now,
    );
  return state(
    "continuous",
    "일반 거래 · 가격 조건과 모의 잔량에 따라 체결합니다.",
    now,
  );
}
/** A VI application flag/standard price is not proof of an active VI. Use dated event history. */
export function activeVi(
  output: unknown,
  symbol: string,
  day: string,
): boolean {
  if (!Array.isArray(output)) throw Error("VI 현황 형식을 확인할 수 없습니다.");
  const events = output.filter(
    (row) => row?.mksc_shrn_iscd === symbol && row?.bsop_date === day,
  );
  const validTime = (t: unknown) =>
    typeof t === "string" &&
    /^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(t) &&
    t !== "000000";
  for (const row of output) {
    if (
      !row ||
      typeof row.mksc_shrn_iscd !== "string" ||
      typeof row.bsop_date !== "string"
    )
      throw Error("VI 현황 식별 정보가 없습니다.");
  }
  for (const row of events) {
    if (!validTime(row.cntg_vi_hour))
      throw Error("VI 발동 시각을 확인할 수 없습니다.");
    if (
      ![null, undefined, "", "000000"].includes(row.vi_cncl_hour) &&
      (!validTime(row.vi_cncl_hour) || row.vi_cncl_hour < row.cntg_vi_hour)
    )
      throw Error("VI 해제 시각을 확인할 수 없습니다.");
  }
  // Any unresolved event keeps matching paused; elapsed minutes alone never release it.
  return events.some((row) =>
    [null, undefined, "", "000000"].includes(row.vi_cncl_hour),
  );
}
