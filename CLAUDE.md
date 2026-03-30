# 만족도 리포팅 플러그인

만족도조사 설문 결과를 기업담당자용/강사용 메일 리포트로 자동 생성하는 플러그인입니다.

## 시작하기

"만족도 리포팅해줘" 또는 "/report" 라고 입력하면 리포팅이 시작됩니다.

## ⚠️ 문서 동기화 규칙

**SKILL.md 또는 CLAUDE.md를 수정하면, 아래 연관 문서도 같은 턴에서 함께 업데이트한다.** 사용자가 따로 요청하지 않아도 자동으로 수행한다.

1. `~/.claude/만족도_리포팅_아키텍처_하네스_설계_0317.md`
2. `~/.claude/만족도_리포팅_플러그인_설계로그.md`
3. `~/.claude/skills/report/report_OM사용가이드.md`
4. `~/.claude/commands/report/report_OM사용가이드.md` (3번의 복사본 — 슬래시 커맨드 자동완성용)
5. `~/.claude/projects/C--Users-GA--claude/memory/project-satisfaction-survey.md`
6. `~/.claude/projects/C--Users-GA--claude/memory/MEMORY.md`

## 핵심 규칙

- **매 실행마다 반드시 `scripts/check-env.js`를 실행합니다.** 연속 실행이더라도 건너뛰지 않습니다. 업데이트 확인은 이 스크립트에서만 수행됩니다.
- **객관식 점수는 반드시 `scripts/calculate.js`로 계산합니다.** LLM이 직접 계산하지 않습니다.
- **검증은 반드시 `scripts/verify.js`로 실행합니다.** LLM이 직접 판단하지 않습니다. 검증 6번(운영진 의견 근거)은 source 필드에 따라 강의관리시트 또는 raw data 주관식에서 검색합니다.
- **주관식은 문항 성격에 따라 처리합니다.** 포괄적 문항(좋았던 점, 아쉬웠던 점)은 3유형 분류(긍정/개선/추가 교육 니즈) + 요약문. 구체적 문항(기억에 남는 것, 유익했던 방식 등)은 문항별 답변 패턴 정리. 요약문의 근거는 반드시 실제 원문에 기반합니다. 다중 시트 시 시트별로 분리합니다.
- **운영진 의견만 LLM 초안 생성이 허용됩니다.** 근거 없는 주장은 금지, 반드시 출처를 명시합니다. 객관식/주관식에서 이미 보여준 내용을 반복하지 않습니다.
- **한글이 포함된 모든 출력(Bash 명령, 파일 쓰기, 클립보드 복사 등)에서 반드시 UTF-8 인코딩을 사용합니다.** 파일 쓰기 시 `encoding: 'utf-8'` 옵션을 포함하고, 클립보드 복사 시에도 UTF-8 인코딩을 보장하여 한글이 깨지지 않도록 합니다.
- **세션 로그 추출 요청 시 반드시 MD 파일로 생성합니다.** 내부 세션 파일(JSONL)을 복사하지 않습니다. Phase별 진행 요약 + 이슈 판단 근거 + 개선 제안을 포함한 사람이 읽을 수 있는 형태로 정리합니다.

## 폴더 구조

```
~/.claude/skills/report/     (= git clone 대상)
├── CLAUDE.md              ← 이 파일 (프로젝트 규칙)
├── SKILL.md               ← 메인 스킬 (리포팅 전체 흐름, /report로 호출)
├── package.json           ← 패키지 정의
├── scripts/
│   ├── check-env.js       ← 환경 확인 + 자동 업데이트 체크 (첫 실행 시)
│   ├── parse-sheet.js     ← 공용 시트 파싱 모듈
│   ├── calculate.js       ← 객관식 점수 계산
│   ├── verify.js          ← Ralph 루프 자동 검증 (7개 항목 × 시트별 루프)
│   └── generate-shell.js  ← HTML 셸 생성 (고정 CSS/JS → head/tail 반환)
└── templates/
    └── report-shell.html  ← HTML output 템플릿 (CSS/JS 참고용)
```

## HTML output

- 블록 검토와 메일 미리보기를 **처음부터 함께** HTML 파일로 생성합니다.
- **혼재 구조**: `scripts/generate-shell.js`로 고정 부분(CSS/JS)을 head/tail로 받고, LLM은 가변 본문만 Write합니다. CSS/JS를 직접 작성하지 않습니다.
- **헤더**: 기업명(`company-name`, 16px 강조) + 과정명(큰 제목) + 부제(교육일시 | 강사명 | 응답인원)
- **블록 검토 탭**: sub-tab(객관식|주관식|운영진 의견)으로 영역 분리. sub-tab 위에 `review-description`(전체 설명) + `guide-banner`(수정 안내) 고정. 주관식/운영진 의견 sub-tab 안에 `context-notice`(맥락 설명, 배경 없이 텍스트 강조)
- **메일 미리보기 탭**: sub-tab(기업담당자용|강사용)으로 분리. 메일 제목 한 줄 + 본문 (HTML 헤더 미표시). 복사 버튼 2개: "본문 복사"(secondary) + "전체 복사 (제목+본문)"(primary)
- **HTML 자동 열기**: 생성 후 `node -e "require('child_process').exec('start ...')"` 로 브라우저에서 자동으로 엽니다. `start`를 Bash에서 직접 실행하지 않고 node로 감쌈
- **동적 구성**: 없는 블록/탭은 생성 안 함. sub-tab 1개면 탭 바 숨김. 메타 정보도 있는 것만 표시
- **운영진 의견 수신자 라벨**: 블록 검토에서 운영진 의견 초안 위에 "기업담당자용" / "강사용 (강사명)" 라벨 필수
- **긍정비율 기준 명시**: HTML 표 헤더에 5점 척도는 "긍정 비율 (4~5점)", 10점 척도는 "긍정 비율 (7~10점)"
- 메일 미리보기 내 운영진 의견 문단에는 `class="mail-opinion"` 적용 (주관식과 시각적 구분)
- 기업담당자용과 강사용 메일은 완전히 별개 메일이므로, 절대 "(이하 동일)" 등으로 축약하지 않습니다.

## 스크립트 사용법

**⚠️ 스크립트 실행 시 반드시 `cd ~/.claude/skills/report &&`를 앞에 붙여서 실행합니다.**

**⚠️ Windows 환경 주의사항**:
- 임시 파일 경로: `/tmp/` 대신 `os.tmpdir()` 또는 다운로드 폴더 사용
- `node -e` 안에서 백슬래시 이스케이프가 꼬이기 쉬움 → 경로는 슬래시(`/`)로 통일, 정규식 사용 자제
- calculate.js 결과의 `shortName`을 블록 JSON에 넣을 때 **그대로 사용** (임의 축약 금지 — verify.js 문항명 매칭 실패 원인)

```bash
# 환경 확인 (첫 실행 시 자동)
cd ~/.claude/skills/report && node scripts/check-env.js

# 객관식 계산
cd ~/.claude/skills/report && node scripts/calculate.js "파일경로" [시트명]

# Ralph 루프 검증
cd ~/.claude/skills/report && node scripts/verify.js "raw-data-경로" "블록결과.json" [강의관리시트-경로]
```
