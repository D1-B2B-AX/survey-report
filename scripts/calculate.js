/**
 * calculate.js — 객관식 점수 계산 스크립트
 *
 * LLM이 점수를 직접 계산하지 않고, 이 코드가 계산한다.
 * parse-sheet.js로 파싱한 데이터를 기반으로:
 *   - 일반 5점 척도: 평균 + 긍정 비율 (4+5점)
 *   - 양극단 척도: 평균 + 3구간 분포
 *   - 선택형: 선택지별 응답자 수 + 비율
 *   - 총 응답자 수
 *
 * 사용법:
 *   node scripts/calculate.js <파일경로> [시트명]
 *   시트명 생략 시 모든 데이터 시트를 계산한다.
 *
 * 출력: JSON 형식 (Claude Code가 파싱하여 표로 배치)
 */

const path = require('path');
const {
  readInput,
  analyzeWorkbook,
} = require('./parse-sheet.js');

// ============================================================
// 메인
// ============================================================

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('사용법: node scripts/calculate.js <파일경로> [시트명]');
    process.exit(1);
  }

  const input = args[0];
  const targetSheet = args[1] || null;

  // 1) 파일 읽기
  const { workbook, fileName } = readInput(input);
  const analysis = analyzeWorkbook(workbook, fileName);

  // 2) 대상 시트 결정
  const sheetNames = targetSheet
    ? [targetSheet]
    : Object.keys(analysis.sheets);

  if (sheetNames.length === 0) {
    console.error('분석 가능한 데이터 시트가 없습니다.');
    process.exit(1);
  }

  // 3) 시트별 계산
  const results = {};
  for (const sheetName of sheetNames) {
    const sheet = analysis.sheets[sheetName];
    if (!sheet) {
      console.error(`시트 "${sheetName}"을 찾을 수 없습니다.`);
      continue;
    }
    results[sheetName] = calculateSheet(sheet);
  }

  // 4) 결과 출력
  const output = {
    fileName,
    metadata: analysis.metadata,
    results,
  };

  console.log(JSON.stringify(output, null, 2));
}

// ============================================================
// 시트 계산
// ============================================================

/**
 * 시트 내 모든 객관식 문항을 계산한다.
 * @param {object} sheet - parseSheet 결과
 * @returns {object} 계산 결과
 */
function calculateSheet(sheet) {
  const scale5Results = [];
  const bipolarResults = [];
  const selectionResults = [];
  const infoResults = [];

  for (const q of sheet.questions) {
    switch (q.type) {
      case 'scale_5':
        scale5Results.push(calculateScale5(q, sheet.name));
        break;
      case 'scale_10':
        scale5Results.push(calculateScale5(q, sheet.name)); // 10점도 같은 로직
        break;
      case 'bipolar':
        bipolarResults.push(calculateBipolar(q, sheet.name));
        break;
      case 'selection':
        selectionResults.push(calculateSelection(q, sheet.name));
        break;
      case 'info':
        infoResults.push(calculateSelection(q, sheet.name));
        break;
      case 'open_ended':
        // 주관식은 calculate에서 처리하지 않음
        break;
    }
  }

  return {
    sheetName: sheet.name,
    instructor: sheet.instructor,
    respondentCount: sheet.respondentCount,
    scale5: scale5Results,
    bipolar: bipolarResults,
    selection: selectionResults,
    info: infoResults,
  };
}

// ============================================================
// 일반 5점 척도 계산
// ============================================================

/**
 * 일반 5점 척도 문항의 평균 + 긍정 비율을 계산한다.
 * @param {object} question - 문항 객체
 * @param {string} sheetName - 시트 이름
 * @returns {object} 계산 결과
 */
function calculateScale5(question, sheetName) {
  const values = question.responses.map(Number).filter(v => !isNaN(v));
  const count = values.length;

  if (count === 0) {
    return {
      header: question.header,
      shortName: question.shortName,
      instructor: question.instructor,
      average: null,
      positiveRatio: null,
      count: 0,
    };
  }

  const sum = values.reduce((a, b) => a + b, 0);
  const average = roundTo(sum / count, 1);

  // 긍정 비율: 4점 + 5점 비율
  const maxScore = Math.max(...values);
  const positiveThreshold = maxScore <= 5 ? 4 : 7; // 10점 척도면 7점 이상
  const positiveCount = values.filter(v => v >= positiveThreshold).length;
  const positiveRatio = roundTo((positiveCount / count) * 100, 0);

  return {
    header: question.header,
    shortName: question.shortName,
    instructor: question.instructor,
    maxScore: maxScore <= 5 ? 5 : 10,
    average,
    positiveRatio,
    count,
  };
}

// ============================================================
// 양극단 척도 계산
// ============================================================

/**
 * 양극단 척도 문항의 평균 + 3구간 분포를 계산한다.
 * 구간: 낮음(1~2점) / 적절(3점) / 높음(4~5점)
 * @param {object} question - 문항 객체
 * @param {string} sheetName - 시트 이름
 * @returns {object} 계산 결과
 */
function calculateBipolar(question, sheetName) {
  const values = question.responses.map(Number).filter(v => !isNaN(v));
  const count = values.length;

  if (count === 0) {
    return {
      header: question.header,
      shortName: question.shortName,
      instructor: question.instructor,
      average: null,
      distribution: null,
      count: 0,
    };
  }

  const sum = values.reduce((a, b) => a + b, 0);
  const average = roundTo(sum / count, 1);

  // 3구간 분포
  const lowCount = values.filter(v => v <= 2).length;
  const midCount = values.filter(v => v === 3).length;
  const highCount = values.filter(v => v >= 4).length;

  const labels = question.bipolarLabels || { low: '낮음', mid: '적절', high: '높음' };

  return {
    header: question.header,
    shortName: question.shortName,
    instructor: question.instructor,
    average,
    distribution: {
      low: { label: labels.low, count: lowCount, ratio: roundTo((lowCount / count) * 100, 0) },
      mid: { label: labels.mid, count: midCount, ratio: roundTo((midCount / count) * 100, 0) },
      high: { label: labels.high, count: highCount, ratio: roundTo((highCount / count) * 100, 0) },
    },
    count,
  };
}

// ============================================================
// 선택형 문항 계산
// ============================================================

/**
 * 선택형 문항의 선택지별 응답자 수 + 비율을 계산한다.
 * @param {object} question - 문항 객체
 * @param {string} sheetName - 시트 이름
 * @returns {object} 계산 결과
 */
function calculateSelection(question, sheetName) {
  const responses = question.responses.map(v => String(v).trim());
  const count = responses.length;

  // 선택지별 집계
  const counts = {};
  for (const r of responses) {
    counts[r] = (counts[r] || 0) + 1;
  }

  // 빈도 내림차순 정렬
  const choices = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([choice, choiceCount]) => ({
      choice,
      count: choiceCount,
      ratio: roundTo((choiceCount / count) * 100, 0),
    }));

  return {
    header: question.header,
    shortName: question.shortName,
    instructor: question.instructor,
    choices,
    count,
  };
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 소수점 자릿수 반올림
 * @param {number} value - 값
 * @param {number} decimals - 소수점 자릿수
 * @returns {number}
 */
function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ============================================================
// 실행
// ============================================================

main();
