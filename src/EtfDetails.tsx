import { useEffect, useState } from "react";
import type { EtfInfo } from "./etfTypes";
import "./etf.css";
const value = (n: number | null, suffix = "원") =>
  n === null
    ? "자료 없음"
    : n.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + suffix;
export default function EtfDetails({ symbol }: { symbol: string }) {
  const [data, setData] = useState<EtfInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/etf/" + symbol, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error("ETF 정보를 불러오지 못했습니다.");
        return r.json() as Promise<EtfInfo>;
      })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [symbol, reload]);
  const info = data?.symbol === symbol ? data : null;
  return (
    <section className="etf-details" aria-label="ETF 상품 정보">
      <div className="etf-heading">
        <strong>
          <span className="etf-badge">ETF</span> 상품 정보
        </strong>
        <button
          type="button"
          disabled={loading}
          onClick={() => setReload((n) => n + 1)}
        >
          {loading ? "조회 중…" : "새로고침"}
        </button>
      </div>
      {error && <p role="status">{error} 새로고침으로 다시 시도해주세요.</p>}
      {info && (
        <>
          <p className="etf-description">
            {info.referenceIndex ?? "기준 지수 자료 없음"} ·{" "}
            {info.category ?? "분류 자료 없음"}
            {info.multiplier !== null &&
              " · 추적 수익률 " + info.multiplier + "배"}
          </p>
          <dl className="etf-metrics">
            <div>
              <dt>순자산가치 (NAV)</dt>
              <dd>{value(info.nav)}</dd>
            </div>
            <div>
              <dt>조회 당시 거래 가격</dt>
              <dd>{value(info.price)}</dd>
            </div>
            <div>
              <dt>NAV 대비 가격 차이</dt>
              <dd>
                {info.premiumRate === null
                  ? "계산 불가"
                  : (info.premiumRate > 0 ? "+" : "") +
                    info.premiumRate.toFixed(2) +
                    "%"}
              </dd>
            </div>
          </dl>
          <small>
            {info.source === "demo" ? "학습용 가상 수치" : "한국투자증권 조회"}{" "}
            ·{" "}
            {new Date(info.receivedAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}{" "}
            (KST){loading ? " · 갱신 중" : error ? " · 이전 조회 자료" : ""}
          </small>
          {info.multiplier !== null && info.multiplier !== 1 && (
            <p className="etf-strategy">
              인버스·레버리지 상품은 일별 목표 수익률을 추구합니다. 여러 날의
              누적 수익률은 지수 수익률에 배수를 곱한 값과 달라질 수 있습니다.
            </p>
          )}
        </>
      )}
      <details className="etf-guide">
        <summary>가격 차이 읽는 법과 모의투자 적용 범위</summary>
        <p>
          가격 차이 = (조회 가격 ÷ NAV − 1) × 100. 양수면 NAV보다 비싸고, 음수면
          저렴하게 거래된다는 뜻입니다. 제공처의 가격·NAV 평가 시점은 다를 수
          있으며 차이가 해소된다는 보장은 없습니다.
        </p>
        <p>
          ETF 매도 증권거래세는 0원이며 매매 수수료는 적용합니다. 상품별
          매매차익·분배금의 소득세와 분배금 자동 지급은 현재 모의 계산에
          포함하지 않습니다. 펀드 내부 보수·비용은 NAV에 반영되므로 별도로 이중
          차감하지 않습니다.
        </p>
        <p>
          포트폴리오에서는 ETF를 하나의 보유 상품으로 계산합니다. 구성 종목별
          중복 노출은 운용사 구성 자료와 기준일을 확인해 별도로 살펴보세요.
        </p>
      </details>
    </section>
  );
}
