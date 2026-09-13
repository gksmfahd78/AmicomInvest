import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Maximize,
  Play,
  Printer,
  X,
} from "lucide-react";
import {
  investmentCourse,
  courseSlides,
  courseSources,
  courseWeekFromHash,
  type CourseSlide,
} from "./investmentCourse";
import { flushSync } from "react-dom";
import { courseDepth } from "./courseDepth";
import CourseSeminar, { CourseSeminarPrint } from "./CourseSeminar";
import "./investment-education.css";
function SlideContent({ slide }: { slide: CourseSlide }) {
  return (
    <>
      <h2>{slide.title}</h2>
      <ol className="course-points">
        {slide.points.map((point, i) => (
          <li key={point}>
            <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
            <p>{point}</p>
          </li>
        ))}
      </ol>
      <div className="course-example">
        <span>함께 생각하기</span>
        <p>{slide.example}</p>
      </div>
    </>
  );
}
export default function InvestmentEducation({
  onPractice,
}: {
  onPractice: (page: "trade" | "analysis" | "account") => void;
}) {
  const [selected, setSelected] = useState(() =>
    courseWeekFromHash(location.hash),
  );
  const [presenting, setPresenting] = useState(false),
    [index, setIndex] = useState(0),
    [showNotes, setShowNotes] = useState(false);
  const [answer, setAnswer] = useState<number | null>(null),
    [message, setMessage] = useState("");
  const [printMode, setPrintMode] = useState<"slides" | "workbook">("slides");
  function print(mode: "slides" | "workbook") {
    flushSync(() => setPrintMode(mode));
    window.print();
  }
  const depth = courseDepth[selected];
  const dialog = useRef<HTMLDialogElement>(null);
  const presentationFrame = useRef<HTMLDivElement>(null);
  const week = investmentCourse[selected - 1],
    slides = courseSlides(week),
    active = slides[index];
  useEffect(() => {
    const sync = () => {
      setSelected(courseWeekFromHash(location.hash));
      setIndex(0);
      setAnswer(null);
      setPresenting(false);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!presenting || !element) return;
    element.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (document.fullscreenElement === presentationFrame.current)
        void document.exitFullscreen().catch(() => {});
      element.close();
      document.body.style.overflow = old;
    };
  }, [presenting]);
  function choose(value: number) {
    setSelected(value);
    setIndex(0);
    setAnswer(null);
    setShowNotes(false);
    setMessage("");
    history.replaceState(history.state, "", `#education/week/${value}`);
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(
        new URL(`#education/week/${selected}`, location.href).href,
      );
      setMessage(
        "주차 링크를 복사했습니다. 로그인 후 같은 자료를 열 수 있습니다.",
      );
    } catch {
      setMessage("주소창의 주차 링크를 복사해 공유해 주세요.");
    }
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (presentationFrame.current?.requestFullscreen)
        await presentationFrame.current.requestFullscreen();
      else setMessage("이 브라우저에서는 전체 화면 전환을 지원하지 않습니다.");
    } catch {
      setMessage(
        "전체 화면 전환을 사용할 수 없습니다. 현재 발표 화면에서 계속 진행할 수 있습니다.",
      );
    }
  }
  return (
    <div className="education-page">
      <section
        className="panel course-overview"
        aria-label="8주 투자 교육 안내"
      >
        <div>
          <span className="course-eyebrow">
            AMICOM INVEST · LEARNING STUDIO
          </span>
          <h2>
            처음 배우는 투자,
            <br />
            8주 동안 나의 기준 만들기
          </h2>
          <p>
            개념을 배우고, 모의투자로 확인하고, 내 말로 설명하는 과정입니다.
          </p>
        </div>
        <div className="course-facts">
          <div>
            <b>8주</b>
            <span>입문자 과정</span>
          </div>
          <div>
            <b>
              {investmentCourse.reduce(
                (total, item) => total + courseSlides(item).length,
                0,
              )}
              장
            </b>
            <span>발표 슬라이드</span>
          </div>
          <div>
            <b>90분</b>
            <span>주차별 권장 시간</span>
          </div>
        </div>
        <p className="course-scope">
          가상 회사의 자료를 읽고 계산한 뒤, 근거가 있는 분석 문장과 발표
          원고까지 완성합니다. 주차별 수업 90분에 사전 읽기와 수업 후 복습을
          더해 활용하세요. 계산 사례는 학습용 가정이며 특정 종목 추천이
          아닙니다.
        </p>
      </section>
      <div className="course-layout">
        <nav className="course-week-nav" aria-label="투자 교육 주차">
          <label className="course-week-select">
            주차 선택
            <select
              value={selected}
              onChange={(e) => choose(Number(e.target.value))}
              aria-label="교육 주차 선택"
            >
              {investmentCourse.map((item) => (
                <option key={item.week} value={item.week}>
                  {item.week}주차 · {item.title}
                </option>
              ))}
            </select>
          </label>
          <div className="course-week-buttons">
            {investmentCourse.map((item) => (
              <button
                type="button"
                key={item.week}
                aria-current={item.week === selected ? "step" : undefined}
                onClick={() => choose(item.week)}
              >
                <span>{String(item.week).padStart(2, "0")}</span>
                <div>
                  <b>{item.title}</b>
                  <small>{item.subtitle}</small>
                </div>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </nav>
        <section
          className="panel course-detail"
          aria-label={`${selected}주차 학습 자료`}
        >
          <header className="course-detail-heading">
            <span className="course-eyebrow">
              WEEK {String(selected).padStart(2, "0")} · 90 MIN
            </span>
            <h2>
              {selected}주차 · {week.title}
            </h2>
            <p>{week.subtitle}</p>
            <div className="course-actions">
              <button
                type="button"
                className="course-primary"
                onClick={() => {
                  setIndex(0);
                  setShowNotes(false);
                  setMessage("");
                  setPresenting(true);
                }}
              >
                <Play size={16} />
                발표 시작
              </button>
              <button type="button" onClick={() => print("slides")}>
                <Printer size={16} />
                슬라이드 PDF
              </button>
              <button type="button" onClick={() => print("workbook")}>
                <Printer size={16} />
                교재·활동지 PDF
              </button>
              <button type="button" onClick={copyLink}>
                <Copy size={16} />
                주차 링크 복사
              </button>
            </div>
          </header>
          {message && !presenting && (
            <p className="course-message" role="status">
              {message}
            </p>
          )}
          <nav className="course-section-nav" aria-label="학습 자료 바로가기">
            {[
              ["lessons", "강의 본문"],
              ["worked", "단계별 예제"],
              ["review", "질문·연습문제"],
              ["reading", "상세 해설"],
              ["slides", "슬라이드"],
              ["case", "사례 풀이"],
              ["worksheet", "활동지"],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                onClick={() =>
                  document
                    .getElementById(`course-${id}`)
                    ?.scrollIntoView({ block: "start" })
                }
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="course-objectives">
            <h3>이번 주에 할 수 있게 되는 것</h3>
            <ul>
              {week.goals.map((goal) => (
                <li key={goal}>
                  <Check size={16} />
                  {goal}
                </li>
              ))}
            </ul>
          </div>
          <CourseSeminar key={selected} week={selected} />
          <section
            id="course-reading"
            className="course-reading"
            aria-label="상세 해설"
          >
            <span className="course-eyebrow">READ & UNDERSTAND</span>
            <h3>개념을 내 말로 설명하기</h3>
            {depth.reading.map((section) => (
              <article key={section.title}>
                <h4>{section.title}</h4>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </article>
            ))}
          </section>
          <div id="course-slides" className="course-slide-list">
            <h3>
              발표 자료 미리 보기 <span>{slides.length}장</span>
            </h3>
            {slides.map((slide, i) => (
              <details
                key={selected + ":" + i}
                className="course-slide-preview"
              >
                <summary>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {slide.title}
                </summary>
                <div className="course-preview-body">
                  <SlideContent slide={slide} />
                  <details className="course-teacher-note">
                    <summary>진행자 메모</summary>
                    <p>{slide.notes}</p>
                  </details>
                  <button
                    type="button"
                    onClick={() => {
                      setIndex(i);
                      setShowNotes(false);
                      setPresenting(true);
                    }}
                  >
                    이 슬라이드부터 발표
                  </button>
                </div>
              </details>
            ))}
          </div>
          <section
            id="course-case"
            className="course-case"
            aria-label="사례 풀이"
          >
            <span className="course-eyebrow">CASE STUDY · 20 MIN</span>
            <h3>{depth.caseStudy.title}</h3>
            <p className="course-case-scenario">{depth.caseStudy.scenario}</p>
            <ol>
              {depth.caseStudy.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ol>
            <details key={selected} className="course-case-solution">
              <summary>모범 답안·풀이 보기</summary>
              <ol>
                {depth.caseStudy.solution.map((solution) => (
                  <li key={solution}>{solution}</li>
                ))}
              </ol>
            </details>
          </section>
          <section
            id="course-worksheet"
            className="course-worksheet"
            aria-label="학습 활동지"
          >
            <h3>내 생각을 기록하는 활동지</h3>
            <p>
              교재·활동지 PDF를 인쇄하거나 아래 질문을 노트에 옮겨 작성하세요.
            </p>
            <ol>
              {depth.worksheet.map((prompt) => (
                <li key={prompt}>{prompt}</li>
              ))}
            </ol>
          </section>
          <div className="course-practice">
            <div>
              <span className="course-eyebrow">PRACTICE · 20 MIN</span>
              <h3>화면에서 직접 해보기</h3>
              <ol>
                {week.practice.map((task) => (
                  <li key={task}>{task}</li>
                ))}
              </ol>
            </div>
            <button type="button" onClick={() => onPractice(week.destination)}>
              <BookOpen size={16} />
              {week.destination === "trade"
                ? "트레이딩"
                : week.destination === "analysis"
                  ? "시장 분석"
                  : "내 투자 계좌"}{" "}
              열기
            </button>
          </div>
          <div className="course-discussion">
            <h3>같이 이야기해요 · 10분</h3>
            <p>{week.discussion}</p>
            <h3>다음 주까지 해볼 일</h3>
            <p>{week.homework}</p>
          </div>
          <section className="course-quiz" aria-label="주차 확인 문제">
            <h3>배운 내용 확인하기</h3>
            <p>{week.quiz.question}</p>
            <div>
              {week.quiz.options.map((option, i) => (
                <button
                  type="button"
                  key={option}
                  aria-pressed={answer === i}
                  onClick={() => setAnswer(i)}
                >
                  <span>{i + 1}</span>
                  {option}
                </button>
              ))}
            </div>
            {answer !== null && (
              <p className="course-answer" role="status">
                <b>
                  {answer === week.quiz.answer
                    ? "맞았습니다."
                    : "다시 생각해 보세요."}
                </b>{" "}
                {week.quiz.explanation}
              </p>
            )}
          </section>
          <div className="course-sources">
            <h3>공식 참고 자료</h3>
            <p>
              일반 개념과 원문 확인을 위한 자료입니다. 예시 계산과 실습·토론
              구성은 아미콤 교육용으로 작성했습니다.
            </p>
            <ul>
              {week.sources.map((key) => (
                <li key={key}>
                  <a
                    href={courseSources[key].url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {courseSources[key].title} ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <footer className="course-week-footer">
            <button
              type="button"
              disabled={selected === 1}
              onClick={() => choose(selected - 1)}
            >
              <ArrowLeft size={16} />
              이전 주차
            </button>
            <span>{selected} / 8주차</span>
            <button
              type="button"
              disabled={selected === 8}
              onClick={() => choose(selected + 1)}
            >
              다음 주차
              <ArrowRight size={16} />
            </button>
          </footer>
        </section>
      </div>
      <dialog
        className="course-presentation"
        ref={dialog}
        aria-label={`${selected}주차 발표`}
        onCancel={() => setPresenting(false)}
        onKeyDown={(event) => {
          if (
            event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement ||
            event.target instanceof HTMLSelectElement
          )
            return;
          if (
            [
              "ArrowRight",
              "PageDown",
              "ArrowLeft",
              "PageUp",
              "Home",
              "End",
            ].includes(event.key)
          ) {
            event.preventDefault();
            if (event.key === "Home") setIndex(0);
            else if (event.key === "End") setIndex(slides.length - 1);
            else
              setIndex((i) =>
                Math.max(
                  0,
                  Math.min(
                    slides.length - 1,
                    i +
                      (["ArrowRight", "PageDown"].includes(event.key) ? 1 : -1),
                  ),
                ),
              );
          }
        }}
      >
        <div className="course-presentation-frame" ref={presentationFrame}>
          <header className="course-presentation-toolbar">
            <span>
              {selected}주차 · {week.title}
            </span>
            <div>
              <button
                type="button"
                onClick={fullscreen}
                aria-label="전체 화면 전환"
              >
                <Maximize size={18} />
              </button>
              <button
                type="button"
                onClick={() => setPresenting(false)}
                aria-label="발표 닫기"
              >
                <X size={20} />
              </button>
            </div>
          </header>
          <div className="course-presentation-body">
            <div className="course-slide" key={selected + ":" + index}>
              <span className="course-eyebrow">
                AMICOM INVEST · {String(index + 1).padStart(2, "0")} /{" "}
                {String(slides.length).padStart(2, "0")}
              </span>
              <SlideContent slide={active} />
            </div>
            {showNotes && (
              <aside className="course-presenter-notes">
                <strong>진행자 메모 · 현재 화면에도 표시됩니다</strong>
                <p>{active.notes}</p>
              </aside>
            )}
            {message && <p role="status">{message}</p>}
          </div>
          <footer className="course-presentation-controls">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => setIndex((i) => i - 1)}
              aria-label="이전 슬라이드"
            >
              <ArrowLeft size={20} />
              <span>이전</span>
            </button>
            <div>
              <span aria-live="polite">
                {index + 1} / {slides.length}
              </span>
              <button
                type="button"
                aria-pressed={showNotes}
                onClick={() => setShowNotes((v) => !v)}
              >
                진행자 메모
              </button>
            </div>
            <button
              type="button"
              disabled={index === slides.length - 1}
              onClick={() => setIndex((i) => i + 1)}
              aria-label="다음 슬라이드"
            >
              <span>다음</span>
              <ArrowRight size={20} />
            </button>
          </footer>
        </div>
      </dialog>
      <div
        className={`course-print-deck ${printMode === "workbook" ? "course-workbook" : ""}`}
        aria-hidden="true"
      >
        {printMode === "slides" ? (
          slides.map((slide, i) => (
            <section className="course-print-slide" key={i}>
              <header>
                아미콤 투자 교육 · {selected}주차 {week.title} · {i + 1}/
                {slides.length}
              </header>
              <SlideContent slide={slide} />
              <footer>
                입문자 과정 · 학습용 예시 ·{" "}
                {week.sources
                  .map((key) => courseSources[key].title)
                  .join(" / ")}
              </footer>
            </section>
          ))
        ) : (
          <>
            {depth.reading.map((section, i) => (
              <section className="course-print-slide" key={section.title}>
                <header>
                  아미콤 투자 교육 · {selected}주차 {week.title} · 교재 {i + 1}
                  /12
                </header>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                <h3>읽고 정리하기</h3>
                <p>
                  핵심 개념을 한 문장으로 설명하고, 아직 이해되지 않는 부분을
                  기록하세요.
                </p>
                <div className="course-writing-lines" />
              </section>
            ))}
            <section className="course-print-slide">
              <header>
                아미콤 투자 교육 · {selected}주차 {week.title} · 사례 3/12
              </header>
              <h2>{depth.caseStudy.title}</h2>
              <p>{depth.caseStudy.scenario}</p>
              <ol className="course-print-questions">
                {depth.caseStudy.questions.map((question) => (
                  <li key={question}>
                    {question}
                    <div className="course-writing-lines" />
                  </li>
                ))}
              </ol>
            </section>
            <section className="course-print-slide">
              <header>
                아미콤 투자 교육 · {selected}주차 {week.title} · 풀이 4/12
              </header>
              <h2>모범 답안과 토론</h2>
              <ol>
                {depth.caseStudy.solution.map((solution) => (
                  <li key={solution}>{solution}</li>
                ))}
              </ol>
              <h3>함께 토론하기</h3>
              <p>{week.discussion}</p>
              <h3>다음 주까지 해볼 일</h3>
              <p>{week.homework}</p>
            </section>
            <section className="course-print-slide">
              <header>
                아미콤 투자 교육 · {selected}주차 {week.title} · 활동지 5/12
              </header>
              <h2>내 생각을 기록합니다</h2>
              <ol className="course-print-prompts">
                {depth.worksheet.map((prompt) => (
                  <li key={prompt}>
                    {prompt}
                    <div className="course-writing-lines" />
                  </li>
                ))}
              </ol>
              <h3>공식 참고 자료</h3>
              <div className="course-print-sources">
                {week.sources.map((key) => (
                  <p key={key}>
                    {courseSources[key].title}
                    <br />
                    {courseSources[key].url}
                  </p>
                ))}
              </div>
            </section>
            <CourseSeminarPrint week={selected} title={week.title} />
          </>
        )}
      </div>
    </div>
  );
}
