import type { ExecutionState } from "./executionRules";
import type { Order } from "./types";
import "./execution-details.css";
const phaseNames: Record<ExecutionState["phase"], string> = {
  continuous: "일반 거래",
  demo: "데모 체결",
  opening_auction: "시가 단일가",
  closing_auction: "종가 단일가",
  off_hours: "장 운영 시간 외",
  holiday: "휴장",
  vi: "VI 발동",
  halted: "거래 정지",
  unknown: "체결 보류",
};
export function TradingStateNotice({
  state,
}: {
  state: ExecutionState | undefined;
}) {
  return (
    <div
      className={"execution-state " + (state?.canTrade ? "ready" : "paused")}
      aria-label="거래 상태"
    >
      <strong>{state ? phaseNames[state.phase] : "거래 상태 확인 중"}</strong>
      <p>{state?.reason ?? "제공처의 거래 상태를 확인하고 있습니다."}</p>
      {state && !state.canTrade && (
        <small>
          대기 주문의 취소는 가능합니다. 실제 단일가 체결은 재현하지 않습니다.
        </small>
      )}
    </div>
  );
}
export function FillEvidence({
  fill,
}: {
  fill: NonNullable<Order["fills"]>[number];
}) {
  if (!fill.execution_note)
    return (
      <small className="fill-evidence">
        이전 체결에는 당시 호가 근거가 기록되지 않았습니다.
      </small>
    );
  const delta =
    fill.reference_price == null ? null : fill.price - fill.reference_price;
  return (
    <div className="fill-evidence">
      <p>{fill.execution_note}</p>
      {fill.reference_price != null && (
        <small>
          판단 시 최우선 상대 호가{" "}
          {fill.reference_price.toLocaleString("ko-KR")}원 · 체결가격 차이{" "}
          {delta! > 0 ? "+" : ""}
          {delta!.toLocaleString("ko-KR")}원
        </small>
      )}
      {fill.book_received_at != null && (
        <small>
          호가 수신{" "}
          {new Date(fill.book_received_at).toLocaleString("ko-KR", {
            timeZone: "Asia/Seoul",
          })}{" "}
          (KST)
        </small>
      )}
    </div>
  );
}
