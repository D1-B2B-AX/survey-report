/**
 * verify.js — Ralph 루프 자동 검증 스크립트
 *
 * LLM이 생성한 블록 결과물을 raw data와 대조하여 7개 항목을 검증한다.
 * 모든 검증은 코드로 실행한다. LLM이 판단하지 않는다.
 *
 * 사용법:
 *   node scripts/verify.js <raw-data-경로> <블록-결과-JSON-경로> [강의관리시트-경로]
 *
 * 블록 결과 JSON 구조:
 *   {
 *     "sheetName": "리더1차수",
 *     "respondentCount": 40,
 *     "questions": [
 *       { "shortName": "커리큘럼", "header": "...", "average": 4.1, "maxScore": 5, "positiveRatio": 92 }
 *     ],
 *     "subjectiveQuotes": [
 *       { "text": "직접 해볼 수 있어서 좋았다" }
 *     ],
 *     "managementQuotes": [
 *       { "text": "호응이 큰 편은 아니나 집중도 높음" }
 *     ],
 *     "scoreCitations": [
 *       { "value": 4.1, "context": "전체 만족도 4.1점" }
 *     ]
 *   }
 *
 * 출력: JSON — 항목별 pass/fail + 상세 내용
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const {
  readInput,
  analyzeWorkbook,
  formatLocation,
} = require('./parse-sheet.js');

// ============================================================
// JSON 형식 정규화
// ============================================================

/**
 * LLM이 생성하는 다양한 블록 JSON 형식을 verify.js가 기대하는 형식으로 정규화한다.
 *
 * 지원하는 입력 형식:
 *   형식 A (기존 단일 시트): { sheetName, respondentCount, questions, subjectiveQuotes, ... }
 *   형식 B (블록 단일 시트): { block0: {respondentCount}, block1: {scale5, ...}, ... }
 *   형식 C (블록 다중 시트): { block0: {sheets: [...]}, block1: {"시트명": {...}, ...}, ... }
 *
 * 다중 시트(형식 C)면 시트별 정규화 객체 배열을 반환한다.
 * 단일 시트(형식 A, B)면 1개짜리 배열을 반환한다.
 *
 * @param {object} data - 원본 JSON
 * @param {string[]} availableSheets - raw data의 시트 이름 목록
 * @returns {object[]} 시트별 정규화된 JSON 배열
 */
function normalizeBlockJson(data, availableSheets) {
  // 이미 형식 A면 배열로 감싸서 반환
  if (data.sheetName && data.questions) {
    return [data];
  }

  // 형식 B 또는 C (block0, block1, ...)
  if (data.block0 || data.block1) {
    const block0 = data.block0 || {};
    const block1 = data.block1 || {};
    const block2 = data.block2 || {};
    const block3 = data.block3 || {};
    const block4 = data.block4 || {};

    // 다중 시트 감지: block1에 시트 이름이 키로 들어있는지 확인
    const block1SheetKeys = Object.keys(block1).filter(k => availableSheets.includes(k));
    const isMultiSheet = block1SheetKeys.length > 0;

    // 시트 목록 결정
    const sheetList = isMultiSheet
      ? block1SheetKeys
      : [data.sheetName || (availableSheets.length === 1 ? availableSheets[0] : availableSheets[0])];

    // 시트별 respondentCount 매핑 (block0.sheets 배열에서)
    const respondentCountMap = {};
    if (block0.sheets && Array.isArray(block0.sheets)) {
      for (const s of block0.sheets) {
        respondentCountMap[s.sheetName] = s.respondentCount;
      }
    }

    // 주관식 인용문 수집 (전체 — 시트 공통으로 검증)
    const subjectiveQuotes = collectSubjectiveQuotes(block2);

    // 운영진 의견 근거 수집 (전체)
    const managementQuotes = collectManagementQuotes([block3, block4]);

    // 점수 인용 수집 (전체)
    const scoreCitations = collectScoreCitations([block3, block4]);

    // 시트별 정규화 객체 생성
    const results = [];
    for (const sheetName of sheetList) {
      const sheetBlock1 = isMultiSheet ? block1[sheetName] : block1;
      const questions = extractQuestions(sheetBlock1 || {});

      results.push({
        sheetName,
        respondentCount: respondentCountMap[sheetName] || (isMultiSheet && sheetBlock1 && sheetBlock1.respondentCount) || block0.respondentCount || null,
        questions,
        subjectiveQuotes,
        managementQuotes,
        scoreCitations,
      });
    }

    return results;
  }

  // 알 수 없는 형식 — 배열로 감싸서 반환
  return [data];
}

/**
 * block1 (단일 시트용) 에서 객관식 문항 목록을 추출한다.
 */
function extractQuestions(block1) {
  const questions = [];
  if (block1.scale5) {
    for (const q of block1.scale5) {
      questions.push({ shortName: q.shortName, header: q.header, average: q.average, maxScore: q.maxScore, positiveRatio: q.positiveRatio });
    }
  }
  if (block1.bipolar) {
    for (const q of block1.bipolar) {
      questions.push({ shortName: q.shortName, header: q.header, average: q.average, distribution: q.distribution });
    }
  }
  if (block1.selection) {
    for (const q of block1.selection) {
      questions.push({ shortName: q.shortName, header: q.header, choices: q.choices });
    }
  }
  return questions;
}

/**
 * block2에서 주관식 인용문을 수집한다.
 * 다양한 구조 지원: positive/improvement/additionalNeeds 또는 validResponses.
 */
function collectSubjectiveQuotes(block2) {
  const quotes = [];
  // 유형 분류 구조 (positive, improvement, additionalNeeds)
  for (const category of ['positive', 'improvement', 'additionalNeeds']) {
    if (block2[category] && Array.isArray(block2[category])) {
      for (const item of block2[category]) {
        if (item.sources) {
          for (const s of item.sources) {
            quotes.push({ text: s.text });
          }
        }
      }
    }
  }
  // 기존 validResponses 구조
  const subjSource = block2.validResponses_corporate || block2.validResponses_instructor || block2.validResponses || [];
  for (const r of subjSource) {
    quotes.push({ text: r.text || r });
  }
  return quotes;
}

/**
 * block3/block4에서 운영진 의견 근거 인용문을 수집한다.
 * source 필드를 함께 보존하여 검증 시 검색 대상을 분기한다.
 */
function collectManagementQuotes(blocks) {
  const quotes = [];
  for (const block of blocks) {
    if (block.sources) {
      for (const s of block.sources) {
        if (s.original) {
          quotes.push({ text: s.original, source: s.source || '강의관리시트' });
        }
      }
    }
  }
  return quotes;
}

/**
 * block3/block4에서 점수 인용을 수집한다.
 */
function collectScoreCitations(blocks) {
  const citations = [];
  for (const block of blocks) {
    if (block.sources) {
      for (const s of block.sources) {
        const numMatch = s.original ? s.original.match(/(\d+\.?\d*)\s*[/점]/) : null;
        if (numMatch) {
          citations.push({ value: parseFloat(numMatch[1]), context: s.original });
        }
      }
    }
  }
  return citations;
}

// ============================================================
// 메인
// ============================================================

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('사용법: node scripts/verify.js <raw-data-경로> <블록-결과-JSON-경로> [강의관리시트-경로]');
    process.exit(1);
  }

  const rawDataInput = args[0];
  const outputJsonPath = path.resolve(args[1]);
  const managementInput = args[2] || null;

  // 1) raw data 읽기 + 분석
  const { workbook, fileName } = readInput(rawDataInput);
  const analysis = analyzeWorkbook(workbook, fileName);

  // 2) 블록 결과 JSON 읽기 + 형식 정규화 (다중 시트면 배열로 반환)
  const rawOutputData = JSON.parse(fs.readFileSync(outputJsonPath, 'utf-8'));
  const sheetOutputs = normalizeBlockJson(rawOutputData, Object.keys(analysis.sheets));

  // 3) 강의관리 시트 읽기 (raw 텍스트 기반 — 설문 구조가 아니므로 직접 읽기)
  let managementTexts = [];
  if (managementInput) {
    managementTexts = readAllCellTexts(path.resolve(managementInput));
  }

  // 4) 모든 시트의 주관식 원문 수집 (시트 횡단 검증용)
  const allRawSubjectiveTexts = [];
  for (const rawSheet of Object.values(analysis.sheets)) {
    for (const q of rawSheet.questions) {
      if (q.type === 'open_ended') {
        for (let i = 0; i < q.responses.length; i++) {
          allRawSubjectiveTexts.push({
            text: String(q.responses[i]).trim(),
            location: formatLocation(rawSheet.name, q.rowMapping[i]),
          });
        }
      }
    }
  }

  // 5) 시트별 루프 — 검증 1~4 (시트별), 검증 5~7 (전체)
  const sheetResults = [];
  for (const outputData of sheetOutputs) {
    const rawSheet = analysis.sheets[outputData.sheetName];
    if (!rawSheet) {
      console.error(`raw data에서 시트 "${outputData.sheetName}"을 찾을 수 없습니다.`);
      console.error('사용 가능한 시트:', Object.keys(analysis.sheets).join(', '));
      continue;
    }

    const checks = [
      checkRespondentCount(rawSheet, outputData),
      checkQuestionNames(rawSheet, outputData),
      checkScaleNotation(rawSheet, outputData),
      checkRounding(outputData),
      checkSubjectiveQuotesAll(allRawSubjectiveTexts, outputData),
      checkManagementQuotesRaw(managementTexts, allRawSubjectiveTexts, outputData),
      checkScoreCitationsAll(analysis.sheets, outputData),
    ];

    sheetResults.push({
      sheetName: outputData.sheetName,
      checks,
      allPassed: checks.every(c => c.passed),
      passCount: checks.filter(c => c.passed).length,
      failCount: checks.filter(c => !c.passed).length,
    });
  }

  // 6) 최종 출력
  const finalResult = {
    fileName,
    sheetCount: sheetResults.length,
    sheets: sheetResults,
    allPassed: sheetResults.every(s => s.allPassed),
  };

  console.log(JSON.stringify(finalResult, null, 2));
}

/**
 * 엑셀 파일의 모든 시트에서 모든 셀 텍스트를 수집한다.
 * 강의관리 시트처럼 설문 구조가 아닌 파일을 검색하기 위한 용도.
 * @param {string} filePath - 엑셀 파일 절대 경로
 * @returns {string[]} 모든 셀의 텍스트 배열
 */
function readAllCellTexts(filePath) {
  const wb = XLSX.readFile(filePath, { type: 'file' });
  const texts = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    for (const row of data) {
      if (!row) continue;
      for (const cell of row) {
        if (cell !== null && cell !== undefined && cell !== '') {
          texts.push(String(cell).trim());
        }
      }
    }
  }
  return texts;
}

// ============================================================
// 검증 1: 응답자 수 일치
// ============================================================

/**
 * raw data의 실제 응답 행 수와 블록에 표기된 응답인원이 일치하는지 확인한다.
 */
function checkRespondentCount(rawSheet, outputData) {
  const actual = rawSheet.respondentCount;
  const stated = outputData.respondentCount;

  return {
    id: 1,
    name: '응답자 수 일치',
    passed: actual === stated,
    actual,
    stated,
    detail: actual === stated
      ? `${actual}명 일치`
      : `raw data: ${actual}명, 블록 표기: ${stated}명`,
  };
}

// ============================================================
// 검증 2: 문항명 매칭
// ============================================================

/**
 * raw data 헤더에서 추출한 문항명과 블록의 문항명이 일치하는지 확인한다.
 */
function checkQuestionNames(rawSheet, outputData) {
  const outputQuestions = outputData.questions || [];
  if (outputQuestions.length === 0) {
    return {
      id: 2,
      name: '문항명 매칭',
      passed: true,
      detail: '검증할 문항 없음 (블록에 문항이 없음)',
      mismatches: [],
    };
  }

  // raw data의 객관식 문항 shortName 목록 (공백 정규화)
  const normalize = s => s.replace(/\s+/g, ' ').trim();
  const rawNames = rawSheet.questions
    .filter(q => q.type !== 'open_ended' && q.type !== 'info')
    .map(q => q.shortName);

  const mismatches = [];
  for (const oq of outputQuestions) {
    const found = rawNames.some(rn =>
      normalize(rn) === normalize(oq.shortName) || rn.includes(oq.shortName) || oq.shortName.includes(rn)
    );
    if (!found) {
      mismatches.push({
        outputName: oq.shortName,
        detail: 'raw data에 매칭되는 문항명 없음',
      });
    }
  }

  return {
    id: 2,
    name: '문항명 매칭',
    passed: mismatches.length === 0,
    totalChecked: outputQuestions.length,
    mismatches,
    detail: mismatches.length === 0
      ? `${outputQuestions.length}개 문항 전부 매칭`
      : `${mismatches.length}개 불일치`,
  };
}

// ============================================================
// 검증 3: 척도 표기 일치
// ============================================================

/**
 * 각 문항의 점수와 만점 기준이 올바르게 표기되었는지 확인한다.
 * 예: 5점 척도 문항이 "/10점"으로 표기되면 실패
 */
function checkScaleNotation(rawSheet, outputData) {
  const outputQuestions = outputData.questions || [];
  const mismatches = [];

  for (const oq of outputQuestions) {
    // raw data에서 같은 문항 찾기
    const rawQ = rawSheet.questions.find(rq =>
      rq.shortName === oq.shortName ||
      rq.shortName.includes(oq.shortName) ||
      oq.shortName.includes(rq.shortName)
    );
    if (!rawQ) continue;

    // 척도 타입에 따른 만점 확인
    if (rawQ.type === 'scale_5' && oq.maxScore && oq.maxScore !== 5) {
      mismatches.push({
        shortName: oq.shortName,
        expected: '5점',
        stated: `${oq.maxScore}점`,
      });
    }
    if (rawQ.type === 'scale_10' && oq.maxScore && oq.maxScore !== 10) {
      mismatches.push({
        shortName: oq.shortName,
        expected: '10점',
        stated: `${oq.maxScore}점`,
      });
    }
  }

  return {
    id: 3,
    name: '척도 표기 일치',
    passed: mismatches.length === 0,
    mismatches,
    detail: mismatches.length === 0
      ? '척도 표기 정상'
      : `${mismatches.length}개 불일치`,
  };
}

// ============================================================
// 검증 4: 반올림 자릿수 통일
// ============================================================

/**
 * 블록 내 모든 수치의 소수점 자릿수가 일관되는지 확인한다.
 * 기준: 소수점 1자리
 */
function checkRounding(outputData) {
  const outputQuestions = outputData.questions || [];
  const inconsistencies = [];

  for (const oq of outputQuestions) {
    if (oq.average !== null && oq.average !== undefined) {
      const decimalPlaces = getDecimalPlaces(oq.average);
      if (decimalPlaces > 1) {
        inconsistencies.push({
          shortName: oq.shortName,
          value: oq.average,
          decimalPlaces,
          expected: 1,
        });
      }
    }
  }

  return {
    id: 4,
    name: '반올림 자릿수 통일',
    passed: inconsistencies.length === 0,
    inconsistencies,
    detail: inconsistencies.length === 0
      ? '소수점 1자리 통일'
      : `${inconsistencies.length}개 항목 자릿수 불일치`,
  };
}

/**
 * 숫자의 소수점 자릿수를 반환한다.
 */
function getDecimalPlaces(num) {
  const str = String(num);
  const dotIndex = str.indexOf('.');
  if (dotIndex === -1) return 0;
  return str.length - dotIndex - 1;
}

// ============================================================
// 검증 5: 주관식 원문 존재 확인 (hallucination 탐지)
// ============================================================

/**
 * (구버전 — 단일 시트용, 호환성 유지)
 */
function checkSubjectiveQuotes(rawSheet, outputData) {
  return checkSubjectiveQuotesAll(
    rawSheet.questions
      .filter(q => q.type === 'open_ended')
      .flatMap(q => q.responses.map((r, i) => ({
        text: String(r).trim(),
        location: formatLocation(rawSheet.name, q.rowMapping[i]),
      }))),
    outputData
  );
}

/**
 * 블록에서 인용한 주관식 텍스트가 raw data(전체 시트)에 실제로 존재하는지 확인한다.
 * @param {Array} allRawTexts - 모든 시트의 주관식 원문 [{text, location}]
 * @param {object} outputData - 정규화된 블록 데이터
 */
function checkSubjectiveQuotesAll(allRawTexts, outputData) {
  const quotes = outputData.subjectiveQuotes || [];
  if (quotes.length === 0) {
    return {
      id: 5,
      name: '주관식 원문 존재 확인',
      passed: true,
      detail: '검증할 인용문 없음',
      missing: [],
    };
  }

  const missing = [];
  for (const quote of quotes) {
    const quoteText = normalizeQuotes(String(quote.text));
    const found = allRawTexts.some(rt => {
      const rawText = normalizeQuotes(rt.text);
      return rawText.includes(quoteText) || quoteText.includes(rawText);
    });
    if (!found) {
      missing.push({
        quotedText: String(quote.text).trim(),
        detail: 'raw data에서 원문을 찾을 수 없음 (hallucination 가능성)',
      });
    }
  }

  return {
    id: 5,
    name: '주관식 원문 존재 확인',
    passed: missing.length === 0,
    totalChecked: quotes.length,
    missing,
    detail: missing.length === 0
      ? `${quotes.length}개 인용문 전부 확인됨`
      : `${missing.length}개 원문 미발견 (hallucination 가능성)`,
  };
}

// ============================================================
// 검증 6: 운영진 의견 근거 원문 존재 확인
// ============================================================

/**
 * (구버전 — 호환성 유지)
 */
function checkManagementQuotes(managementAnalysis, outputData) {
  const mgmtTexts = [];
  if (managementAnalysis) {
    for (const sheet of Object.values(managementAnalysis.sheets)) {
      for (const q of sheet.questions) {
        for (const r of q.responses) {
          mgmtTexts.push(String(r).trim());
        }
      }
    }
  }
  return checkManagementQuotesRaw(mgmtTexts, [], outputData);
}

/**
 * 운영진 의견 근거 표에 인용된 원문이 실제로 존재하는지 확인한다.
 * source 필드에 따라 검색 대상을 분기한다:
 *   - "강의관리시트" (기본) → 강의관리 시트 전체 셀 텍스트에서 검색
 *   - "raw data" → raw data 주관식 원문에서 검색
 * @param {string[]} managementTexts - readAllCellTexts로 수집한 강의관리시트 전체 셀 텍스트 배열
 * @param {Array<{text: string, location: string}>} rawSubjectiveTexts - raw data 주관식 원문 배열
 * @param {object} outputData - 정규화된 블록 데이터
 */
function checkManagementQuotesRaw(managementTexts, rawSubjectiveTexts, outputData) {
  const quotes = outputData.managementQuotes || [];

  if (quotes.length === 0) {
    return {
      id: 6,
      name: '운영진 의견 근거 원문 존재',
      passed: true,
      detail: '검증할 근거 인용문 없음',
      missing: [],
    };
  }

  // 강의관리시트도 없고 raw data 주관식도 없으면 검증 불가
  if (managementTexts.length === 0 && rawSubjectiveTexts.length === 0) {
    return {
      id: 6,
      name: '운영진 의견 근거 원문 존재',
      passed: true,
      detail: '강의관리 시트 미제공 + raw data 주관식 없음 — 근거 검증 대상 없음',
      missing: [],
    };
  }

  const missing = [];
  for (const quote of quotes) {
    const quoteText = normalizeQuotes(String(quote.text));
    const source = (quote.source || '강의관리시트').toLowerCase();
    let found = false;

    if (source.includes('raw data') || source.includes('raw_data') || source.includes('주관식')) {
      // raw data 주관식 원문에서 검색
      found = rawSubjectiveTexts.some(r => {
        const normR = normalizeQuotes(String(r.text));
        return normR.includes(quoteText) || quoteText.includes(normR);
      });
      // raw data에서 못 찾으면 강의관리시트에서도 시도 (fallback)
      if (!found && managementTexts.length > 0) {
        found = managementTexts.some(mt => {
          const normMt = normalizeQuotes(mt);
          return normMt.includes(quoteText) || quoteText.includes(normMt);
        });
      }
    } else {
      // 강의관리시트에서 검색
      if (managementTexts.length > 0) {
        found = managementTexts.some(mt => {
          const normMt = normalizeQuotes(mt);
          return normMt.includes(quoteText) || quoteText.includes(normMt);
        });
      }
      // 강의관리시트에서 못 찾으면 raw data에서도 시도 (fallback)
      if (!found) {
        found = rawSubjectiveTexts.some(r => {
          const normR = normalizeQuotes(String(r.text));
          return normR.includes(quoteText) || quoteText.includes(normR);
        });
      }
    }

    if (!found) {
      const searchTarget = source.includes('raw data') ? 'raw data' : '강의관리 시트';
      missing.push({
        quotedText: quoteText,
        detail: `${searchTarget} 및 fallback 검색에서도 원문을 찾을 수 없음`,
      });
    }
  }

  return {
    id: 6,
    name: '운영진 의견 근거 원문 존재',
    passed: missing.length === 0,
    totalChecked: quotes.length,
    missing,
    detail: missing.length === 0
      ? `${quotes.length}개 근거 원문 전부 확인됨`
      : `${missing.length}개 근거 원문 미발견`,
  };
}

// ============================================================
// 검증 7: 점수 인용 정확도
// ============================================================

/**
 * (구버전 — 단일 시트용, 호환성 유지)
 */
function checkScoreCitations(rawSheet, outputData) {
  return checkScoreCitationsAll({ [rawSheet.name]: rawSheet }, outputData);
}

/**
 * 운영진 의견 내 인용된 수치가 calculate.js 계산 결과와 일치하는지 확인한다.
 * 전체 시트를 대상으로 점수를 검색한다.
 * @param {object} allSheets - analysis.sheets (시트명 → 시트 객체)
 * @param {object} outputData - 정규화된 블록 데이터
 */
function checkScoreCitationsAll(allSheets, outputData) {
  const citations = outputData.scoreCitations || [];

  if (citations.length === 0) {
    return {
      id: 7,
      name: '점수 인용 정확도',
      passed: true,
      detail: '검증할 점수 인용 없음',
      mismatches: [],
    };
  }

  // 모든 시트에서 실제 계산된 평균값 목록 수집
  const actualAverages = {};
  for (const rawSheet of Object.values(allSheets)) {
    for (const q of rawSheet.questions) {
      if (q.type === 'scale_5' || q.type === 'scale_10' || q.type === 'bipolar') {
        const values = q.responses.map(Number).filter(v => !isNaN(v));
        if (values.length > 0) {
          const sum = values.reduce((a, b) => a + b, 0);
          const avg = roundTo(sum / values.length, 1);
          actualAverages[q.shortName] = avg;
          actualAverages[q.header] = avg;
        }
      }
    }
  }

  const mismatches = [];
  const sortedEntries = Object.entries(actualAverages).sort((a, b) => b[0].length - a[0].length);

  for (const citation of citations) {
    const citedValue = Number(citation.value);
    let matched = false;
    for (const [name, actualValue] of sortedEntries) {
      if (citation.context && citation.context.includes(name)) {
        if (citedValue !== actualValue) {
          mismatches.push({ context: citation.context, citedValue, actualValue, questionName: name });
        }
        matched = true;
        break;
      }
    }
    if (!matched) {
      const existsAnywhere = Object.values(actualAverages).includes(citedValue);
      if (!existsAnywhere) {
        mismatches.push({ context: citation.context, citedValue, actualValue: null, detail: '해당 수치가 어떤 문항의 계산 결과에도 없음' });
      }
    }
  }

  return {
    id: 7,
    name: '점수 인용 정확도',
    passed: mismatches.length === 0,
    totalChecked: citations.length,
    mismatches,
    detail: mismatches.length === 0
      ? `${citations.length}개 점수 인용 전부 정확`
      : `${mismatches.length}개 점수 불일치`,
  };
}

// ============================================================
// 유틸리티
// ============================================================

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * 문자열의 따옴표·공백을 정규화한다.
 * 유니코드 둥근 따옴표 → ASCII 직선 따옴표, 다중 공백 → 단일 공백.
 * 검증 5, 6에서 원문 비교 시 사용.
 * @param {string} str
 * @returns {string}
 */
function normalizeQuotes(str) {
  return str
    .replace(/[\u2018\u2019\u201A\u2039\u203A]/g, "'")   // 둥근 작은따옴표 → '
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')    // 둥근 큰따옴표 → "
    .replace(/\s+/g, ' ')                                  // 다중 공백 → 단일
    .trim();
}

// ============================================================
// 실행
// ============================================================

main();
