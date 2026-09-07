# 아미콤 · 스터디 투자실

React + TypeScript + Node.js로 만든 스터디용 국내 주식 모의투자 웹앱입니다.
관리자가 가상 투자금을 지급하고 회원이 종목 차트·호가를 확인하며 매매합니다.

## 실행

Node.js 22.13 이상이 필요합니다. Node의 내장 SQLite를 사용합니다.

```powershell
cd D:\study
npm install
Copy-Item .env.example .env
npm run dev
```

개발 화면: http://127.0.0.1:5173
서버: http://127.0.0.1:3001

배포 빌드를 로컬에서 확인하려면:

```powershell
npm run build
npm start
```

이 경우 http://127.0.0.1:3001 에서 화면까지 제공합니다.

## 첫 로그인

- 관리자 아이디: `admin`
- 초기 비밀번호: `Study!2026`
- 회원 초대 코드: `STUDY2026`

위 값은 로컬 개발 기본값입니다. 스터디에 공개하기 전에 .env의 ADMIN_PASSWORD와 STUDY_INVITE_CODE를 정하고 **최초 실행**하세요.
관리자 계정은 DB에 관리자가 없을 때만 생성되므로, 기존 계정 비밀번호는 .env 변경으로 바뀌지 않습니다.
기존 데이터가 있는 상태의 관리자 비밀번호 변경은 아래 명령으로 가능합니다. 기존 세션도 해제합니다.

```powershell
$env:NEW_ADMIN_PASSWORD='새로운-긴-비밀번호'
npx tsx server/reset-admin.ts
Remove-Item Env:NEW_ADMIN_PASSWORD
```

가입 시 현금은 0원입니다. 관리자 화면에서 대상을 선택하고 가상 투자금을 지급하세요.
관리자 본인에게도 지급할 수 있습니다.

## 구현 범위

- 초대 코드 회원가입, 로그인, 로그아웃, 서버 세션 및 관리자 권한
- 주요 국내 종목 8개 검색, 계정별 브라우저 관심 종목
- 캔들 차트와 거래량, 일·주·월봉, 10단계 호가
- 시장가·지정가 매수/매도, 주문 취소, 매매 이유 기록
- 미체결 매수 현금 예약, 미체결 매도 수량 예약
- 계좌 평가금액, 평균 매수가, 평가·실현손익, 최근 주문 200건
- 관리자 투자금 지급과 지급 기록, 스터디 수익률 랭킹
- SQLite 영속 저장, 트랜잭션 기반 체결, 요청 ID로 중복 주문·지급 방지

## 시세 연결

기본값 `MARKET_PROVIDER=demo`는 **합성 샘플 데이터**입니다. 실제 종목명만 사용하며 가격·차트·호가는 실제 값이 아닙니다.
샘플 모드는 시간과 무관하게 거래할 수 있습니다. 이 데이터로 시작한 계좌는 실제 시세 계좌와 섞지 마세요.

한국투자증권 API를 사용할 때는 서버의 .env에 다음 값을 설정하고 재시작하세요:

```dotenv
MARKET_PROVIDER=kis
DATABASE_PATH=./data/study-kis.sqlite
KIS_APP_KEY=발급받은_앱키
KIS_APP_SECRET=발급받은_앱시크릿
```

키는 브라우저에 전달하지 않습니다. 실제 주문 API를 호출하는 코드는 없습니다.
현재가·캔들·호가 REST API와 KIS WebSocket 시세를 사용합니다. 실시간 연결 실패 시 15초 조회 방식으로 보완합니다.
API 응답 캐시와 요청 직렬화가 적용되어 있습니다. 연결 실패 시 샘플 가격으로 대체하지 않습니다.
**실제 발급 키가 없어 실제 API 응답 및 권한은 아직 검증하지 못했습니다.**
데이터 이용 및 회원 대상 표시 가능 범위는 제공처의 계약을 확인해야 합니다.

공식 참고 자료:

- [현재가 조회](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_price/inquire_price.py)
- [기간별 캔들](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/inquire_daily_itemchartprice.py)
- [호가 조회](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_asking_price_exp_ccn/inquire_asking_price_exp_ccn.py)


## 프로젝트 구조

- `src/App.tsx`: 거래, 계좌, 관리자, 랭킹, 로그인 화면
- `src/Chart.tsx`: SVG 캔들 및 거래량 차트
- `server/index.ts`: HTTP API, 인증 및 미체결 처리
- `server/db.ts`: SQLite 스키마, 지급 및 체결 트랜잭션
- `server/market.ts`: 샘플/KIS 시세 어댑터 및 초기 종목 목록
- `data/`: 실행 시 생성되는 데이터베이스 (버전 관리 제외)

현재 단일 스터디, 단일 서버 기준 SQLite를 사용합니다.
여러 스터디 운영이나 여러 서버 배포 시 PostgreSQL과 작업 큐로 확장할 수 있습니다.
외부 배포 전 HTTPS, 운영 비밀번호, 초대 코드, 백업과 운영 환경을 설정해야 합니다.
기본 바인딩은 127.0.0.1이므로 로컬에서만 접속됩니다.

## 검증

```powershell
npm test
npm run build
npm run test:ui
```

UI 테스트는 Microsoft Edge를 사용하며 별도 메모리 DB에서 실행되어 실제 데이터를 변경하지 않습니다.
테스트 스크린샷은 `artifacts/`에 저장됩니다.

## 코스피 · 코스닥 전체 주식

한국투자증권 공식 종목 마스터를 내려받아 전체 주식 목록을 제공합니다.
주식·외국주식·주식예탁증서·리츠·투자회사 등 주식형 종목을 포함하며 ETF·ETN·ELW·신주인수권은 제외합니다.
시장 필터, 종목명·코드 검색, 관심 종목, 10종목 단위 페이지를 지원합니다.
시세 API는 페이지에 표시되는 최대 10종목만 요청합니다. 전체 시장 동시 시세 순위는 제공하지 않습니다.

목록 캐시는 data/stock-master.json에 저장되며 서버 시작 시 24시간 이상 지난 경우 및 실행 중 매일 갱신합니다.
갱신 실패 시 기존 캐시를 유지합니다. 수동 갱신: npm run sync:stocks (이후 서버 재시작).
최초 실행 환경에서 다운로드가 실패하고 캐시도 없으면 기존 기본 종목으로 실행합니다.

공식 형식: https://github.com/koreainvestment/open-trading-api/blob/main/stocks_info/kis_kospi_code_mst.py
및 https://github.com/koreainvestment/open-trading-api/blob/main/stocks_info/kis_kosdaq_code_mst.py


## 고도화 기능

1. 차트: 최근 100봉을 기본으로 표시하고 이전 100봉을 이동평균 계산에 사용합니다. ‘과거 더 보기’로 100봉씩 추가하며 보고 있던 구간은 유지합니다. 상장 초기처럼 원본 데이터가 부족한 구간에는 이동평균을 임의로 만들지 않습니다. 일·주·월 단위를 구분합니다.
2. 실시간: 서버에서 KIS H0STASP0(10호가)·H0STCNT0(체결 시세)를 수신해 인증된 SSE로 현재 선택 종목에 전달합니다. 키는 서버에만 있습니다. 재연결·수신 상태 표시 및 REST 대체 조회를 지원합니다. 서버 연결 하나에서 최대 20종목(40개 구독)을 공유하며 대기 주문 종목을 우선합니다. 초과 종목은 REST 조회로 처리합니다.
3. 체결: 매수는 매도호가, 매도는 매수호가를 가격 우선·접수 순으로 소진합니다. 지정가는 한도 내 부분 체결, 시장가는 제공 호가 내 부분 체결 후 잔량 취소입니다. 동일 가격에서 사용한 모의 수량은 당일 유지되므로 다른 호가 변화·가격의 표시 범위 이탈·서버 재시작으로 재충전되지 않습니다. 다음 한국 날짜의 새 호가에서 초기화합니다.
4. 규칙: KIS 휴장일과 거래 정지 상태, 국내 주식 호가 단위, 상·하한가를 검사합니다. KIS 모드는 09:00~15:30 정규장만 처리하고 새 미체결 주문은 당일 15:30 만료합니다. 샘플 모드는 시간 제한 없이 24시간 유효합니다. 업그레이드 전 주문은 기존 유효기간을 유지합니다.
5. 주문: 체결 진행률·개별 체결 내역·실시간 알림을 표시합니다. 정정은 남은 수량 이하로만 가능하며 기존 주문 잔여분 취소와 새 주문 접수를 한 트랜잭션으로 처리합니다. 실패 시 원래 주문을 보존하고 추가 체결이 생겼으면 재확인을 요구합니다. 새 주문은 새 접수 순서를 가지며 기존 체결은 유지합니다.
6. 그림: 계정·종목·봉 종류별 SQLite 저장과 브라우저 백업을 지원합니다. 서버 저장본이 없으면 기존 로컬 그림을 옮깁니다. 동시 수정 충돌은 덮어쓰지 않고 오류와 재시도·서버 다시 불러오기를 표시합니다. 저장 중에는 차트 닫기·봉 전환을 보류합니다.

실제 거래소에 주문을 보내지 않는 모의 엔진입니다. 거래소의 내 앞 대기 주문이나 실제 잔량 감소 원인은 알 수 없어 잔량 추정은 보수적이며 실제 체결과 다를 수 있습니다. 동시호가·VI 경매·특별 개장시간·배당·분할·수수료·세금·결제일 처리는 아직 모델링하지 않습니다. 특수 거래일 시간은 일반 정규장 기준이므로 추가 보완이 필요합니다.

추가 파일: `server/realtime.ts`, `server/trading.ts`, `server/drawings.ts`, `src/tradingRules.ts`, `src/useDrawingSync.ts`.

검증: `npm test` (체결/잔량/정정/만료/그림 충돌/실시간 파싱), `npm run test:ui` (주문·권한·과거 차트·다른 브라우저 그림 저장).

참고한 공식 자료:
- [KIS 실시간 인증·구독 예제](https://github.com/koreainvestment/open-trading-api/blob/main/examples_user/kis_auth.py)
- [KIS 휴장일 조회](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/chk_holiday/chk_holiday.py)
- [KRX 주식 호가 단위](https://regulation.krx.co.kr/contents/RGL/03/03010100/RGL03010100T3.jsp)
