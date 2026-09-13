# 아미콤 투자 스터디 발표 자료

웹 페이지와 분리된 실제 편집용 PPTX 자료입니다. 한빛식품의 가상 자료를 중심으로 각 주차의 핵심 질문을 시각적 계산과 분석 문장으로 설명합니다. 슬라이드에 긴 강의 문단을 복사하는 대신 강의 원고와 진행 질문을 발표자 노트에 넣었습니다.

- `output/`: 주차별·통합 PPTX, PDF, 재배포 가능한 Noto 글꼴과 사용 안내
- `src/deck_content.py`: 발표 순서와 슬라이드별 편집 내용
- `src/build_decks.py`: 16:9 디자인과 편집 가능한 도형·텍스트 생성
- `src/course-data.json`: 검증한 강의 자료와 공식 참고 링크의 제작 시점 스냅샷
- `src/review_decks.py`: PPT 텍스트와 실제 렌더링 비교, 화면 밖 텍스트 검사, 미리보기 생성
- `review/`: 검수용 슬라이드 이미지와 검증 결과

생성: `artifacts/pptx-venv/bin/python presentations/src/build_decks.py`

렌더링: LibreOffice Impress의 PDF 변환을 사용합니다. 한글 배치를 유지하려면 `Noto Sans CJK KR` Regular/Bold 글꼴이 필요합니다.

이 자료 제작은 웹서비스 변경이나 배포를 포함하지 않습니다.
