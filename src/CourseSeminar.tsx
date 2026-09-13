import { useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { courseLessons, type CourseSeminar as Seminar } from "./courseLessons";
import "./course-seminar.css";

function WorkedTable({ worked }: { worked: Seminar["worked"] }) {
  return (
    <table className="course-worked-table">
      <caption>{worked.title} · 학습용 가상 자료</caption>
      <thead>
        <tr>
          {worked.columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {worked.rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, i) =>
              i === 0 ? (
                <th scope="row" key={i}>
                  {cell}
                </th>
              ) : (
                <td key={i}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export default function CourseSeminar({ week }: { week: number }) {
  const material = courseLessons[week];
  const [step, setStep] = useState(0);
  return (
    <>
      <section
        className="course-seminar"
        id="course-lessons"
        aria-label="강의 본문"
      >
        <span className="course-eyebrow">LESSON TEXT · 읽고 설명하는 강의</span>
        <h3>자료를 읽고 분석 메모까지 완성하기</h3>
        <p className="course-seminar-intro">
          한빛식품은 강의용 가상 회사입니다. 실제 공시·뉴스를 인용한 자료가
          아닙니다. 주식 보유부터 주문, 공시 분석, 가치 평가, 뉴스 해석, 복기와
          최종 발표까지 주어진 자료를 읽고 계산한 뒤 완성된 설명 문장과
          비교하세요. 각 소단원에 확인할 자료와 계산 과정, 해석, 발표할 문장을
          담았습니다.
        </p>
        {material.lessons.map((lesson, i) => (
          <details key={lesson.title} className="course-lesson" open={i === 0}>
            <summary>
              <span>0{i + 1}</span>
              {lesson.title}
            </summary>
            <div className="course-lesson-body">
              {lesson.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              <p className="course-takeaway">
                <strong>핵심 정리</strong>
                {lesson.takeaway}
              </p>
            </div>
          </details>
        ))}
      </section>
      <section
        className="course-seminar"
        id="course-worked"
        aria-label="단계별 예제"
      >
        <span className="course-eyebrow">WORKED EXAMPLE</span>
        <h3>{material.worked.title}</h3>
        <p>{material.worked.context}</p>
        <WorkedTable worked={material.worked} />
        <p className="course-seminar-intro">
          먼저 표를 보고 직접 계산하거나 설명해 본 뒤, 풀이를 한 단계씩
          확인하세요.
        </p>
        <div className="course-worked-actions">
          <button
            type="button"
            onClick={() => setStep((value) => value + 1)}
            disabled={step === material.worked.steps.length}
          >
            <ArrowRight size={16} />
            {step === 0 ? "첫 번째 풀이 보기" : "다음 풀이 보기"}
          </button>
          <button
            type="button"
            onClick={() => setStep(0)}
            disabled={step === 0}
          >
            <RotateCcw size={16} />
            다시 풀기
          </button>
          <span role="status">
            {step} / {material.worked.steps.length}단계
          </span>
        </div>
        <ol className="course-worked-steps">
          {material.worked.steps.slice(0, step).map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ol>
        {step === material.worked.steps.length && (
          <p className="course-takeaway">
            <strong>결과 해석</strong>
            {material.worked.conclusion}
          </p>
        )}
      </section>
      <section
        className="course-seminar"
        id="course-review"
        aria-label="질문과 연습문제"
      >
        <span className="course-eyebrow">ASK & APPLY</span>
        <h3>자주 묻는 질문</h3>
        <div className="course-faq">
          {material.faq.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
        <h3 className="course-exercises-heading">혼자 풀어보는 연습문제</h3>
        <p className="course-seminar-intro">
          노트에 답과 이유를 적은 뒤 해설을 확인하세요. 서술형 해설은 가능한
          답의 예시이며 응답은 저장하지 않습니다.
        </p>
        <div className="course-exercises">
          {material.exercises.map((item, i) => (
            <article key={item.question}>
              <h4>문제 {i + 1}</h4>
              <p>{item.question}</p>
              <p className="course-exercise-hint">힌트 · {item.hint}</p>
              <details>
                <summary>정답과 해설 보기</summary>
                <p>{item.answer}</p>
              </details>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
export function CourseSeminarPrint({
  week,
  title,
}: {
  week: number;
  title: string;
}) {
  const material = courseLessons[week];
  const header = (page: number, label: string) => (
    <header>
      아미콤 투자 교육 · {week}주차 {title} · {label} {page}/12
    </header>
  );
  return (
    <>
      {material.lessons.map((lesson, i) => (
        <section className="course-print-slide" key={lesson.title}>
          {header(i + 6, "강의 본문")}
          <h2>{lesson.title}</h2>
          {lesson.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <h3>핵심 정리</h3>
          <p>{lesson.takeaway}</p>
        </section>
      ))}
      <section className="course-print-slide">
        {header(9, "단계별 예제")}
        <h2>{material.worked.title}</h2>
        <p>{material.worked.context}</p>
        <WorkedTable worked={material.worked} />
        <ol>
          {material.worked.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p>{material.worked.conclusion}</p>
      </section>
      <section className="course-print-slide">
        {header(10, "질문과 답변")}
        <h2>자주 묻는 질문</h2>
        {material.faq.map((item) => (
          <div className="course-print-review" key={item.question}>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </div>
        ))}
      </section>
      <section className="course-print-slide">
        {header(11, "연습문제")}
        <h2>혼자 풀어보세요</h2>
        {material.exercises.map((item, i) => (
          <div className="course-print-review" key={item.question}>
            <h3>문제 {i + 1}</h3>
            <p>{item.question}</p>
            <p>힌트 · {item.hint}</p>
            <div className="course-writing-lines" />
          </div>
        ))}
      </section>
      <section className="course-print-slide">
        {header(12, "연습문제 해설")}
        <h2>정답과 해설</h2>
        {material.exercises.map((item, i) => (
          <div className="course-print-review" key={item.question}>
            <h3>문제 {i + 1}</h3>
            <p>{item.answer}</p>
          </div>
        ))}
        <p>
          서술형 해설은 가능한 답의 예시입니다. 답이 다르다면 계산 기준과 근거가
          타당한지 비교해 보세요.
        </p>
      </section>
    </>
  );
}
