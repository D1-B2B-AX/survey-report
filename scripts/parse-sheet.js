/**
 * parse-sheet.js — 공용 시트 파싱 모듈
 *
 * calculate.js, verify.js에서 공통으로 사용.
 * 엑셀 파일을 읽고, 시트 구조를 분석하고, 문항 타입을 분류한다.
 */

const XLSX = require('xlsx');
const path = require('path');

// ============================================================
// 상수 정의
// ============================================================

/** 양극단 척도 판별 키워드 (문항명 기준) */
const BIPOLAR_KEYWORDS = [
  '난이도 인식', '난이도 정도',
  '강의 속도',
  '교육 운영',
];

/** 양극단 척도 판별 패턴 (척도 설명 기준) */
const BIPOLAR_SCALE_PATTERNS = [
  /쉬움.*어려움|어려움.*쉬움/,
  /느림.*빠름|빠름.*느림/,
  /짧다.*길다|길다.*짧다|짧음.*길음/,
];

/** 양극단 척도별 라벨 매핑 */
const BIPOLAR_LABELS = {
  '난이도': { low: '쉬움', mid: '적절', high: '어려움' },
  '강의 속도': { low: '느림', mid: '적절', high: '빠름' },
  '교육 운영': { low: '짧음', mid: '적절', high: '길음' },
};

/** 주관식 유도 키워드 (문항 텍스트에 포함되면 응답 패턴과 무관하게 주관식 확정) */
const OPEN_ENDED_HEADER_PATTERNS = [
  /자유롭게\s*작성/,
  /작성해\s*주세요/,
  /의견.*있다면/,
  /의견.*있으시면/,
  /무엇인가요/,
  /무엇인지/,
  /있으신가요/,
  /어떤\s*점/,
  /이유를/,
  /좋았던\s*점/,
  /아쉬웠던\s*점/,
  /개선이\s*필요한/,
  /바라는\s*점/,
  /의견\s*공유/,
  /참고.*좋을\s*의견/,
  /느낀\s*점/,
];

/** 정보성 문항 패턴 (만족도 평가가 아닌 사실/상태 확인 문항) */
const INFO_QUESTION_PATTERNS = [
  /차수.*선택|일자.*선택|진행.*차수/,
  /소속.*선택|소속을|소속\s*(부서|팀)/,
  /부서를?\s*선택|부서명/,
  /직급|직책|직위/,
  /적격성/,
  /^이름$|^성명$|^성함$/,
];

/**
 * 문항 텍스트 → 축약명 매핑 (대괄호가 없는 긴 문항용)
 * 주의: [커리큘럼], [난이도] 등 대괄호가 있으면 bracket 추출이 먼저 처리됨.
 *       여기서는 대괄호 없는 긴 서술형 문항만 대상.
 *       "난이도 정도"(5자) 같이 이미 짧은 텍스트는 그대로 두는 게 맞음.
 */
const QUESTION_SHORTNAME_PATTERNS = [
  { pattern: /전반적.*만족/, name: '전반적 만족도' },
  { pattern: /사전\s*기대|기대.*부합/, name: '사전 기대 부합' },
  { pattern: /이론.*실습.*구성|내용.*구성|커리큘럼.*구성/, name: '교육 내용/구성' },
  { pattern: /이해.*쉬운.*전달|효과적.*전달|전달.*방법/, name: '강사 전달력' },
  { pattern: /충분히\s*준비|준비.*상태/, name: '강사 준비성' },
  { pattern: /교육\s*시간.*일정|시간.*일정|학습.*대비.*시간/, name: '교육 시간/일정' },
  { pattern: /추천.*의향|추천.*지수|추천.*점수/, name: '추천 의향' },
  { pattern: /현업.*적용|업무.*적용|업무.*활용/, name: '현업 적용도' },
  { pattern: /업무.*관련성/, name: '업무 관련성' },
];

/** 메타 열 판별 패턴 (응답 데이터가 아닌 열) */
const META_COLUMN_PATTERNS = [
  /타임스탬프/i, /timestamp/i,
  /이메일/i, /email/i,
  /응답자/i, /이름/i, /성명/i,
  /^ID$/i, /응답\s?ID/i, /답변\s?ID/i,
  /시작일시/i, /종료일시/i, /제출일시/i,
  /start.*time/i, /end.*time/i, /submit.*time/i,
];

/** 응답 데이터가 아닐 가능성이 높은 시트 탭 이름 패턴 */
const LIKELY_NON_DATA_PATTERNS = [
  /요약/i, /통계/i, /summary/i, /^index$/i,
];

// ============================================================
// 파일 읽기
// ============================================================

/**
 * 로컬 엑셀 파일을 읽어서 workbook 객체를 반환한다.
 * @param {string} filePath - 엑셀 파일 경로
 * @returns {object} XLSX workbook 객체
 */
function readWorkbook(filePath) {
  return XLSX.readFile(filePath, { type: 'file', cellDates: true });
}

/**
 * Buffer에서 workbook 객체를 생성한다.
 * @param {Buffer} buffer - 엑셀 파일 버퍼
 * @returns {object} XLSX workbook 객체
 */
function readWorkbookFromBuffer(buffer) {
  return XLSX.read(buffer, { type: 'buffer', cellDates: true });
}

/**
 * 로컬 파일 경로로 workbook + fileName을 반환한다.
 * CLI에서 이 함수 하나만 호출하면 된다.
 *
 * @param {string} input - 로컬 파일 경로
 * @returns {{workbook: object, fileName: string}}
 */
function readInput(input) {
  const filePath = path.resolve(input);
  const workbook = readWorkbook(filePath);
  const fileName = path.basename(filePath);
  return { workbook, fileName };
}

// ============================================================
// 시트 분석
// ============================================================

/**
 * workbook 전체를 분석하여 구조화된 결과를 반환한다.
 *
 * @param {object} workbook - XLSX workbook 객체
 * @param {string} fileName - 파일명 (메타 정보 추출용)
 * @returns {object} 분석 결과
 *   {
 *     metadata: { fileName, sheetNames, tool, instructorsFromTabs },
 *     sheets: { [sheetName]: { name, instructor, respondentCount, questions } }
 *   }
 */
function analyzeWorkbook(workbook, fileName) {
  const sheetNames = workbook.SheetNames;

  // 탭 기반 강사 감지
  const instructorsFromTabs = detectInstructorsFromTabs(sheetNames);

  // 시트를 데이터 시트 / 비데이터 시트로 분류 (스킵하지 않고 분류만)
  const dataSheetNames = [];
  const nonDataSheetNames = [];
  for (const name of sheetNames) {
    if (isLikelyNonData(name)) {
      nonDataSheetNames.push(name);
    } else {
      dataSheetNames.push(name);
    }
  }

  // 데이터 시트 분석
  const sheets = {};
  for (const sheetName of dataSheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const parsed = parseSheet(worksheet, sheetName, instructorsFromTabs);
    if (parsed) {
      sheets[sheetName] = parsed;
    }
  }

  return {
    metadata: {
      fileName,
      sheetNames,
      dataSheetNames,
      nonDataSheetNames, // 스킵하지 않고 목록만 제공 — 필요 시 참조 가능
      instructorsFromTabs,
    },
    sheets,
  };
}

/**
 * 개별 시트를 분석한다.
 * @param {object} worksheet - XLSX worksheet 객체
 * @param {string} sheetName - 시트 이름
 * @param {string[]} instructorsFromTabs - 탭에서 감지된 강사 목록
 * @returns {object|null} 시트 분석 결과 (데이터가 없으면 null)
 */
function parseSheet(worksheet, sheetName, instructorsFromTabs) {
  const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  // 헤더 행 찾기 (첫 번째 비어있지 않은 행 중 문항 텍스트가 있는 행)
  const headerRowIndex = findHeaderRow(rawData);
  if (headerRowIndex === -1) return null;

  const headers = rawData[headerRowIndex];

  // 응답 데이터 행 추출 (헤더 다음 행부터, 비데이터 행 제외)
  // 원래 rawData 인덱스를 보존하여 엑셀 행 번호를 정확히 추적
  // AVERAGE/평균 행을 만나면 그 이후는 모두 통계 영역으로 간주하여 스킵
  const responseRowsWithIndex = [];
  let hitSummaryLabel = false;
  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || !row.some(cell => cell !== null && cell !== undefined && cell !== '')) continue;

    // AVERAGE/평균 등 통계 라벨 행을 만나면 이후 전부 스킵
    if (!hitSummaryLabel && hasSummaryLabel(row)) {
      hitSummaryLabel = true;
    }
    if (hitSummaryLabel) continue;

    if (isScaleGuideRow(row)) continue;
    if (isSummaryRow(row)) continue;
    responseRowsWithIndex.push({
      row,
      excelRow: i + 1, // 엑셀 행 번호 (1-based)
    });
  }

  if (responseRowsWithIndex.length === 0) return null;

  // 각 열을 문항으로 분류
  const questions = [];
  for (let colIndex = 0; colIndex < headers.length; colIndex++) {
    const header = headers[colIndex];
    if (!header || typeof header !== 'string') continue;
    if (isMetaColumn(header)) continue;

    // 해당 열의 응답 데이터 추출 (비어있지 않은 값만, 엑셀 행 번호 함께 추적)
    const responsesWithRow = [];
    for (const { row, excelRow } of responseRowsWithIndex) {
      const value = row[colIndex];
      if (value !== null && value !== undefined && value !== '') {
        responsesWithRow.push({ value, excelRow });
      }
    }

    if (responsesWithRow.length === 0) continue;

    const responses = responsesWithRow.map(r => r.value);
    const rowMapping = responsesWithRow.map(r => r.excelRow);

    const questionType = classifyQuestion(header, responses);
    const shortName = extractShortName(header);
    const instructor = detectInstructorFromQuestion(header);

    questions.push({
      colIndex,
      header: header.trim(),
      shortName,
      type: questionType.type,
      bipolarLabels: questionType.bipolarLabels || null,
      instructor,
      responses,
      rowMapping,
    });
  }

  // 탭 기반 강사 매칭
  const tabInstructor = instructorsFromTabs.find(name => sheetName.includes(name)) || null;

  return {
    name: sheetName,
    instructor: tabInstructor,
    respondentCount: responseRowsWithIndex.length,
    headerRowIndex: headerRowIndex + 1, // 엑셀 기준 1-based
    questions,
  };
}

// ============================================================
// 헤더 탐지
// ============================================================

/**
 * 헤더 행을 찾는다.
 * 문항 텍스트가 포함된 첫 번째 행을 헤더로 판단한다.
 * @param {Array[]} rawData - 2차원 배열
 * @returns {number} 헤더 행 인덱스 (-1이면 못 찾음)
 */
function findHeaderRow(rawData) {
  // 후보 행을 모두 수집한 뒤, 문자열 셀이 가장 많은 행을 선택한다.
  // 이유: 섹션 라벨 행("→ 사후 진단", "→ 만족도 설문" 등)은
  //       문자열 셀이 2~3개뿐이지만 실제 헤더 행은 문항 수만큼 많다.
  const candidates = [];
  for (let i = 0; i < Math.min(rawData.length, 10); i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    const stringCells = row.filter(cell => typeof cell === 'string' && cell.trim().length > 0);
    if (stringCells.length >= 2) {
      const hasQuestionPattern = stringCells.some(cell =>
        /만족|난이도|추천|강사|커리큘럼|인사이트|교수법|현업|속도|운영|이해|의견|작성|바라는/i.test(cell)
      );
      const hasMetaPattern = stringCells.some(cell =>
        META_COLUMN_PATTERNS.some(pattern => pattern.test(cell))
      );
      if (hasQuestionPattern || hasMetaPattern) {
        candidates.push({ index: i, stringCellCount: stringCells.length });
      }
    }
  }

  if (candidates.length > 0) {
    // 문자열 셀이 가장 많은 행을 헤더로 선택
    candidates.sort((a, b) => b.stringCellCount - a.stringCellCount);
    return candidates[0].index;
  }

  // 못 찾으면 첫 번째 비어있지 않은 행
  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    if (row && row.some(cell => cell !== null && cell !== undefined && cell !== '')) {
      return i;
    }
  }
  return -1;
}

// ============================================================
// 문항 분류
// ============================================================

/**
 * 문항 타입을 분류한다.
 * @param {string} header - 문항 텍스트
 * @param {Array} responses - 응답 데이터 배열
 * @returns {object} { type: 'scale_5'|'bipolar'|'selection'|'open_ended', bipolarLabels? }
 */
function classifyQuestion(header, responses) {
  // 1) 양극단 척도 체크 (문항명 키워드)
  if (isBipolarScale(header)) {
    return {
      type: 'bipolar',
      bipolarLabels: getBipolarLabels(header),
    };
  }

  // 2) 응답값 패턴 분석
  const numericResponses = responses.filter(v => typeof v === 'number' || !isNaN(Number(v)));
  const numericRatio = numericResponses.length / responses.length;

  // 숫자 응답이 80% 이상이면 척도형
  if (numericRatio >= 0.8) {
    const values = numericResponses.map(Number);
    const min = Math.min(...values);
    const max = Math.max(...values);

    // 1~5 범위면 5점 척도
    if (min >= 1 && max <= 5) {
      return { type: 'scale_5' };
    }
    // 1~10 범위면 10점 척도 (NPS 등)
    if (min >= 1 && max <= 10) {
      return { type: 'scale_10' };
    }
    // 그 외 숫자
    return { type: 'scale_other' };
  }

  // 3) 문항 텍스트 기반 분류 (응답 데이터와 무관)
  if (isInfoQuestion(header)) {
    return { type: 'info' };
  }
  if (isOpenEndedByHeader(header)) {
    return { type: 'open_ended' };
  }

  // 4) 선택형 판별: 고유값 비율 + 절대값 기반
  const uniqueValues = [...new Set(responses.map(v => String(v).trim()))];
  const uniqueRatio = uniqueValues.length / responses.length;

  // 고유값 비율 90%+ → 거의 모든 답이 다름 → 주관식
  if (uniqueRatio >= 0.9 && responses.length >= 3) {
    return { type: 'open_ended' };
  }

  // 고유값이 적고 비율도 낮으면 선택형
  if (uniqueValues.length <= 10 && uniqueRatio <= 0.5 && responses.length >= 3) {
    if (isInfoQuestion(header)) {
      return { type: 'info' };
    }
    return { type: 'selection' };
  }

  // 고유값 10 이하지만 비율이 높은 애매한 경우 → 주관식으로 분류
  if (uniqueValues.length <= 10 && uniqueRatio > 0.5) {
    return { type: 'open_ended' };
  }

  // 고유값 10 초과면서 비율 낮은 경우 (대규모 선택형) → 선택형
  if (uniqueValues.length > 10 && uniqueRatio <= 0.3) {
    if (isInfoQuestion(header)) {
      return { type: 'info' };
    }
    return { type: 'selection' };
  }

  // 5) 나머지는 주관식
  return { type: 'open_ended' };
}

/**
 * 양극단 척도인지 판별한다.
 * @param {string} header - 문항 텍스트
 * @returns {boolean}
 */
function isBipolarScale(header) {
  // 대괄호 안의 축약명을 기준으로 판별 (더 정확)
  const bracketMatch = header.match(/\[([^\]]+)\]/);
  const shortName = bracketMatch ? bracketMatch[1] : header;

  // "만족도"가 포함된 문항은 양극단이 아닌 일반 척도
  // 예: "강의 속도 만족도"는 만족도 문항이므로 scale_5
  if (/만족도/.test(shortName)) return false;

  return BIPOLAR_KEYWORDS.some(keyword => shortName.includes(keyword));
}

/**
 * 양극단 척도의 라벨을 반환한다.
 * @param {string} header - 문항 텍스트
 * @returns {object} { low, mid, high }
 */
function getBipolarLabels(header) {
  if (header.includes('난이도')) return BIPOLAR_LABELS['난이도'];
  if (header.includes('속도')) return BIPOLAR_LABELS['강의 속도'];
  if (header.includes('교육 운영')) return BIPOLAR_LABELS['교육 운영'];
  // 기본값
  return { low: '낮음', mid: '적절', high: '높음' };
}

// ============================================================
// 문항명 축약
// ============================================================

/**
 * 문항 텍스트에서 축약명을 추출한다.
 * 대괄호가 있으면 대괄호 안의 텍스트를 사용하고,
 * 없으면 핵심 키워드를 추출한다.
 *
 * @param {string} header - 문항 텍스트
 * @returns {string} 축약명
 */
function extractShortName(header) {
  // 대괄호 안의 텍스트 추출 (예: "[커리큘럼] 내가 기대한..." → "커리큘럼")
  const bracketMatch = header.match(/\[([^\]]+)\]/);
  if (bracketMatch) {
    return bracketMatch[1];
  }

  // 번호 제거 (예: "3-2. 난이도에 대한 만족도" → "난이도에 대한 만족도")
  const cleaned = header.replace(/^[\d]+([-.][\d]+)*[-.]*\s*/, '').trim();

  // 이미 충분히 짧으면 (15자 이하) 그대로 사용
  if (cleaned.length <= 15) return cleaned;

  // 키워드 패턴 매칭 (대괄호 없는 긴 문항 → 핵심 키워드 추출)
  for (const { pattern, name } of QUESTION_SHORTNAME_PATTERNS) {
    if (pattern.test(cleaned)) {
      return name;
    }
  }

  // 매칭 안 되면 30자까지
  if (cleaned.length <= 30) return cleaned;
  return cleaned.substring(0, 30) + '...';
}

// ============================================================
// 강사 감지
// ============================================================

/**
 * 시트 탭 이름에서 강사를 감지한다.
 * (현재는 단순 패턴 — 프로토타입 후 강화)
 *
 * @param {string[]} sheetNames - 시트 탭 이름 목록
 * @returns {string[]} 감지된 강사명 목록
 */
function detectInstructorsFromTabs(sheetNames) {
  // 탭 이름에서 공통 패턴을 제거한 후 남는 고유 부분이 강사명일 수 있음
  // 예: "홍길동_데일리", "김철수_데일리" → ["홍길동", "김철수"]
  // 현재는 빈 배열 반환 — 실제 데이터를 보고 패턴을 정교화할 예정
  // TODO: 프로토타입 후 탭 기반 강사 감지 로직 강화
  return [];
}

/**
 * 문항 텍스트에서 강사명을 감지한다.
 * 예: "송유이 강사가 교육 내용을 이해하기 쉬운 방법으로..." → "송유이"
 *
 * @param {string} header - 문항 텍스트
 * @returns {string|null} 감지된 강사명 (없으면 null)
 */
function detectInstructorFromQuestion(header) {
  // "OOO 강사" 패턴
  const match = header.match(/([가-힣]{2,4})\s*강사/);
  if (match) return match[1];
  return null;
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 메타 열인지 판별한다 (타임스탬프, 이메일 등 응답 데이터가 아닌 열).
 * @param {string} header - 열 헤더 텍스트
 * @returns {boolean}
 */
function isMetaColumn(header) {
  return META_COLUMN_PATTERNS.some(pattern => pattern.test(header));
}

/**
 * 문항 텍스트로 주관식을 판별한다.
 * 응답 데이터와 무관하게, 질문 자체가 자유 서술을 유도하면 주관식으로 확정.
 * @param {string} header - 문항 텍스트
 * @returns {boolean}
 */
function isOpenEndedByHeader(header) {
  return OPEN_ENDED_HEADER_PATTERNS.some(pattern => pattern.test(header));
}

/**
 * 정보성 문항인지 판별한다 (만족도 평가가 아닌 사실/상태 확인 문항).
 * 선택형으로 분류된 문항 중 소속, 차수, 적격성 등을 분리하기 위한 용도.
 * @param {string} header - 문항 텍스트
 * @returns {boolean}
 */
function isInfoQuestion(header) {
  return INFO_QUESTION_PATTERNS.some(pattern => pattern.test(header));
}

/**
 * 응답 데이터가 아닐 가능성이 높은 시트인지 판별한다.
 * 스킵하는 게 아니라, 분류 목적으로만 사용한다.
 * nonDataSheetNames에 포함되어 LLM이 필요 시 참조할 수 있다.
 * @param {string} sheetName - 시트 이름
 * @returns {boolean}
 */
function isLikelyNonData(sheetName) {
  return LIKELY_NON_DATA_PATTERNS.some(pattern => pattern.test(sheetName));
}

/**
 * 척도 안내 행인지 판별한다.
 * 예: ["", "", "", "", "1 ~ 5", "1 ~ 5", "1 ~ 5"]
 * @param {Array} row - 행 데이터
 * @returns {boolean}
 */
function isScaleGuideRow(row) {
  const nonEmptyCells = row.filter(cell => cell !== null && cell !== undefined && cell !== '');
  if (nonEmptyCells.length === 0) return false;
  // 비어있지 않은 셀 대부분이 척도 안내 패턴이면 제외
  const scalePatterns = nonEmptyCells.filter(cell =>
    /^\d+\s*~\s*\d+$/.test(String(cell).trim()) ||
    /^\d+점\s*~\s*\d+점$/.test(String(cell).trim()) ||
    /^1\s*~\s*5$/.test(String(cell).trim()) ||
    /^1\s*~\s*10$/.test(String(cell).trim())
  );
  return scalePatterns.length > 0 && scalePatterns.length >= nonEmptyCells.length * 0.5;
}

/**
 * 평균/통계 행인지 판별한다.
 * 예: [null, null, null, null, 4.2, 4.1, 4.375, ...]
 * 특징: 첫 열(응답자ID)이 비어있고, 나머지에 소수점 숫자가 있는 행
 * @param {Array} row - 행 데이터
 * @returns {boolean}
 */
/**
 * 행에 통계 라벨(AVERAGE, 평균, 합계 등)이 포함되어 있는지 확인한다.
 * 이 행 이후는 모두 통계/요약 영역으로 간주한다.
 * @param {Array} row - 행 데이터
 * @returns {boolean}
 */
function hasSummaryLabel(row) {
  return row.some(cell =>
    typeof cell === 'string' && /^(average|평균|합계|sum|count|총계)/i.test(cell.trim())
  );
}

function isSummaryRow(row) {
  const nonEmptyCells = row.filter(cell => cell !== null && cell !== undefined && cell !== '');
  if (nonEmptyCells.length === 0) return false;

  // 첫 번째 비어있지 않은 셀 확인
  const firstNonEmpty = row.findIndex(cell => cell !== null && cell !== undefined && cell !== '');
  const firstCell = row[firstNonEmpty];

  // 첫 번째 셀이 "AVERAGE", "평균" 등 통계 라벨이면 → 요약 행
  if (typeof firstCell === 'string' && /^(average|평균|합계|sum|count|총계)/i.test(firstCell.trim())) {
    return true;
  }

  // 첫 번째 셀이 정수(응답자 번호)면 응답 데이터일 가능성 높음
  if (Number.isInteger(Number(firstCell)) && Number(firstCell) > 0 && Number(firstCell) < 1000) {
    return false;
  }

  // 숫자 셀 중 소수점이 있는 셀의 비율 확인
  const numericCells = row.filter(cell => typeof cell === 'number' || (!isNaN(Number(cell)) && cell !== null && cell !== '' && cell !== undefined));
  const decimalCells = numericCells.filter(cell => !Number.isInteger(Number(cell)));

  // 소수점 숫자가 절반 이상이면 평균/통계 행으로 판단
  return numericCells.length >= 3 && decimalCells.length >= numericCells.length * 0.5;
}

/**
 * 엑셀 행 번호 기반 위치 문자열을 생성한다.
 * @param {string} sheetName - 시트 이름
 * @param {number} rowNumber - 엑셀 행 번호 (1-based)
 * @returns {string} 예: "'리더1차수' 시트 > 25행"
 */
function formatLocation(sheetName, rowNumber) {
  return `'${sheetName}' 시트 > ${rowNumber}행`;
}

// ============================================================
// 병합 셀 처리
// ============================================================

/**
 * 병합 셀을 고려하여 셀 값을 읽는다.
 * 해당 셀에 값이 없으면 !merges를 확인하여 병합 시작 셀의 값을 반환한다.
 *
 * @param {object} worksheet - XLSX worksheet 객체
 * @param {number} row - 행 (0-based)
 * @param {number} col - 열 (0-based)
 * @returns {*} 셀 값 (없으면 null)
 */
function getMergedCellValue(worksheet, row, col) {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = worksheet[addr];
  if (cell && cell.v !== undefined && cell.v !== null && cell.v !== '') return cell.v;

  const merges = worksheet['!merges'] || [];
  for (const range of merges) {
    if (row >= range.s.r && row <= range.e.r &&
        col >= range.s.c && col <= range.e.c) {
      const startAddr = XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c });
      const startCell = worksheet[startAddr];
      return startCell ? startCell.v : null;
    }
  }
  return null;
}

/**
 * 해당 행+열이 병합 범위의 시작 행이 아닌 연속 행인지 확인한다.
 * (시작 행이면 false, 연속 행이면 true)
 *
 * @param {Array} merges - worksheet['!merges'] 배열
 * @param {number} row - 행 (0-based)
 * @param {number} col - 열 (0-based)
 * @returns {boolean}
 */
function isMergeContinuation(merges, row, col) {
  for (const m of merges) {
    if (row > m.s.r && row <= m.e.r && col >= m.s.c && col <= m.e.c) {
      return true;
    }
  }
  return false;
}

// ============================================================
// 교육 개요 탭 읽기
// ============================================================

/** 교육 개요 과정 정보 키워드 */
const OVERVIEW_COURSE_KEYWORDS = {
  '과정명': /과정명/,
  '교육형태': /교육\s*형태/,
  '교육일정': /교육\s*일정/,
  '교육장소': /교육\s*장소/,
  '교육대상': /교육\s*대상/,
  '교육시수': /교육\s*시수/,
};

/** 교육 개요 인원 섹션 키워드 (순서 중요 — 위에서 아래로 탐색) */
const OVERVIEW_PEOPLE_KEYWORDS = [
  { key: '기업담당자', pattern: /기업\s*담당자/ },
  { key: 'FC담당자', pattern: /FC\s*담당자/ },
  { key: '강사', pattern: /강사/ },
  { key: '조교', pattern: /조교/ },
];

/**
 * 교육 개요 탭을 읽어 구조화된 결과를 반환한다.
 * 병합 셀을 자동으로 처리하여 LLM의 셀 재시도를 제거한다.
 *
 * @param {object} workbook - XLSX workbook 객체
 * @returns {object} { found, tab, courseInfo, people }
 */
function readOverviewTab(workbook) {
  const tabName = workbook.SheetNames.find(s => /교육\s*개요/.test(s));
  if (!tabName) return { found: false, tab: null, courseInfo: {}, people: {} };

  const ws = workbook.Sheets[tabName];
  const merges = ws['!merges'] || [];
  const ref = ws['!ref'] || 'A1';
  const maxRow = Math.min(XLSX.utils.decode_range(ref).e.r, 30);

  // ---- 1. 과정 정보: B열 라벨 키워드 → C열 값 (C:H 병합) ----
  const courseInfo = {};
  for (const [key, pattern] of Object.entries(OVERVIEW_COURSE_KEYWORDS)) {
    for (let r = 0; r <= maxRow; r++) {
      const bVal = getMergedCellValue(ws, r, 1); // B열
      if (bVal && pattern.test(String(bVal))) {
        const cVal = getMergedCellValue(ws, r, 2); // C열 (C:H 병합)
        courseInfo[key] = cVal ? String(cVal).trim() : null;
        break;
      }
    }
  }

  // ---- 2. 인원 섹션: B열 키워드로 섹션 시작 찾기 ----
  // 주의: getMergedCellValue가 아닌 직접 셀 값만 확인한다.
  // 병합 연속 행에서 같은 키워드가 중복 매칭되어 빈 배열로 덮어쓰는 버그 방지.
  const sections = [];
  for (let r = 0; r <= maxRow; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 1 });
    const cell = ws[addr];
    if (!cell || cell.v === undefined || cell.v === null || cell.v === '') continue;
    const bStr = String(cell.v).trim();
    for (const { key, pattern } of OVERVIEW_PEOPLE_KEYWORDS) {
      if (pattern.test(bStr)) {
        // B열 병합 범위로 섹션 끝 행 결정
        let endRow = r;
        for (const m of merges) {
          if (r >= m.s.r && r <= m.e.r && m.s.c === 1) {
            endRow = m.e.r;
            break;
          }
        }
        sections.push({ key, label: bStr, startRow: r, endRow });
      }
    }
  }

  // ---- 3. 각 섹션의 인원 정보 읽기 ----
  const people = {};
  for (const section of sections) {
    const entries = [];
    for (let r = section.startRow; r <= section.endRow; r++) {
      // C열 병합의 연속 행이면 스킵 (같은 사람의 2번째 행)
      if (isMergeContinuation(merges, r, 2)) continue;

      const name = getMergedCellValue(ws, r, 2);  // C열: 이름
      if (!name || String(name).trim() === '-' || String(name).trim() === '') continue;

      const role  = getMergedCellValue(ws, r, 3);  // D열: 직급/역할
      const email = getMergedCellValue(ws, r, 4);  // E열: 이메일 (E:F 병합)
      const phone = getMergedCellValue(ws, r, 6);  // G열: 전화 (G:H 병합)

      entries.push({
        name:  String(name).trim(),
        role:  role  ? String(role).trim()  : null,
        email: email ? String(email).trim() : null,
        phone: phone ? String(phone).trim() : null,
      });
    }
    // 같은 key가 이미 있으면 entries를 합침 (다중 강사 등)
    if (people[section.key]) {
      people[section.key].entries.push(...entries);
    } else {
      people[section.key] = { label: section.label, entries };
    }
  }

  // courseInfo 값이 전부 비어있으면 found: false (탭은 있지만 미작성된 경우)
  const hasAnyCourseInfo = Object.values(courseInfo).some(v => v !== null && v !== '');
  if (!hasAnyCourseInfo) return { found: false, tab: tabName, courseInfo: {}, people: {} };

  return { found: true, tab: tabName, courseInfo, people };
}

// ============================================================
// 모듈 내보내기
// ============================================================

module.exports = {
  // 파일 읽기
  readInput,
  readWorkbook,
  readWorkbookFromBuffer,
  // 분석
  analyzeWorkbook,
  parseSheet,
  // 문항 분류
  classifyQuestion,
  isBipolarScale,
  getBipolarLabels,
  extractShortName,
  // 강사 감지
  detectInstructorsFromTabs,
  detectInstructorFromQuestion,
  // 유틸리티
  isMetaColumn,
  isInfoQuestion,
  isOpenEndedByHeader,
  isLikelyNonData,
  formatLocation,
  findHeaderRow,
  getMergedCellValue,
  // 교육 개요
  readOverviewTab,
  // 상수 (테스트·확장용)
  BIPOLAR_KEYWORDS,
  BIPOLAR_LABELS,
  META_COLUMN_PATTERNS,
  INFO_QUESTION_PATTERNS,
  OPEN_ENDED_HEADER_PATTERNS,
  QUESTION_SHORTNAME_PATTERNS,
  LIKELY_NON_DATA_PATTERNS,
};

// ============================================================
// CLI 엔트리포인트
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--overview')) {
    const filePath = args.find(a => !a.startsWith('--'));
    if (!filePath) {
      console.error('Usage: node parse-sheet.js <파일경로> --overview');
      process.exit(1);
    }
    const wb = readWorkbook(filePath);
    const result = readOverviewTab(wb);
    console.log(JSON.stringify(result, null, 2));
  }
}
