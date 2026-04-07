/**
 * build-html.js — 블록 JSON → HTML 본문 자동 변환
 *
 * 블록 JSON(스키마 준수) + meta.json을 읽어 본문 HTML을 생성한다.
 * generate-shell.js가 head/tail/헤더/hidden을 붙여 최종 HTML을 조립한다.
 *
 * Usage:
 *   node scripts/build-html.js <블록JSON경로> <metaJSON경로> <본문출력경로>
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// CLI
// ============================================================

const blockPath = process.argv[2];
const metaPath = process.argv[3];
const outputPath = process.argv[4];

if (!blockPath || !metaPath || !outputPath) {
  console.error('Usage: node scripts/build-html.js <블록JSON> <metaJSON> <본문출력>');
  process.exit(1);
}

const blocks = JSON.parse(fs.readFileSync(path.resolve(blockPath), 'utf-8'));
const meta = JSON.parse(fs.readFileSync(path.resolve(metaPath), 'utf-8'));

// ============================================================
// 유틸리티
// ============================================================

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function nl2br(str) {
  if (!str) return '';
  return esc(str).replace(/\r?\n/g, '<br>');
}

// ============================================================
// 블록 1: 객관식
// ============================================================

function buildScaleTable(items, positiveLabel, showPositive) {
  if (!items || items.length === 0) return '';
  const thPositive = showPositive ? `<th>긍정 비율 (${positiveLabel})</th>` : '';
  const rows = items.map(q => {
    const tdPositive = showPositive ? `<td>${q.positiveRatio}%</td>` : '';
    return `<tr><td>${esc(q.shortName)}</td><td>${q.average} / ${q.maxScore}점</td>${tdPositive}</tr>`;
  }).join('\n');
  return `<table style="width:auto;border-collapse:collapse;font-size:13px;">
<thead><tr><th>문항</th><th>평균</th>${thPositive}</tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function buildBipolarTable(items, forMail) {
  if (!items || items.length === 0) return '';
  const rows = items.map(q => {
    const d = q.distribution;
    const dist = forMail
      ? `${esc(d.low.label)} ${d.low.ratio}% · ${esc(d.mid.label)} ${d.mid.ratio}% · ${esc(d.high.label)} ${d.high.ratio}%`
      : `${esc(d.low.label)}(1~2점) ${d.low.ratio}% · ${esc(d.mid.label)}(3점) ${d.mid.ratio}% · ${esc(d.high.label)}(4~5점) ${d.high.ratio}%`;
    return `<tr><td>${esc(q.shortName)}</td><td>${q.average} / 5점</td><td>${dist}</td></tr>`;
  }).join('\n');
  return `<table style="width:auto;border-collapse:collapse;font-size:13px;margin-top:12px;">
<thead><tr><th>문항</th><th>평균</th><th>분포</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function buildSelectionTable(items) {
  if (!items || items.length === 0) return '';
  const allRows = items.map(q => {
    return q.choices.map((c, i) => {
      const td1 = i === 0 ? `<td rowspan="${q.choices.length}">${esc(q.shortName)}</td>` : '';
      return `<tr>${td1}<td>${esc(c.choice)}</td><td>${c.count}명</td><td>${c.ratio}%</td></tr>`;
    }).join('\n');
  }).join('\n');
  return `<h3 style="font-size:14px; color:#555; margin:16px 0 6px;">선택형 문항</h3>
<table>
<thead><tr><th>문항</th><th>선택지</th><th>응답자 수</th><th>비율</th></tr></thead>
<tbody>${allRows}</tbody>
</table>`;
}

/** 블록 검토 — 객관식 */
function buildBlock1Review(block1) {
  const sheets = Object.keys(block1);
  return sheets.map((name, i) => {
    const s = block1[name];
    let html = '';
    if (sheets.length > 1) {
      html += `<h3${i > 0 ? ' style="margin-top:28px;"' : ''}>■ ${esc(name)} — ${s.respondentCount}명</h3>`;
    } else {
      html += `<p class="respondent-count">응답인원: ${s.respondentCount}명</p>`;
    }
    if (s.scale5 && s.scale5.length > 0) {
      if (s.scale10 && s.scale10.length > 0) html += '<h3>5점 척도 문항</h3>';
      html += buildScaleTable(s.scale5, '4~5점', true);
    }
    if (s.scale10 && s.scale10.length > 0) {
      html += '<h3>10점 척도 문항</h3>';
      html += buildScaleTable(s.scale10, '7~10점', true);
    }
    if (s.bipolar && s.bipolar.length > 0) {
      if (s.scale5 && s.scale5.length > 0) html += '<h3>양극단 척도 문항</h3>';
      html += buildBipolarTable(s.bipolar, false);
    }
    html += buildSelectionTable(s.selection);
    return html;
  }).join('\n');
}

/** 메일 — 객관식 */
function buildBlock1Mail(block1, showPositive) {
  const sheets = Object.keys(block1);
  return sheets.map((name, i) => {
    const s = block1[name];
    let html = '';
    if (sheets.length > 1) {
      html += `<p style="font-size:13px;${i > 0 ? 'margin-top:24px;' : ''}"><strong>■ ${esc(name)}</strong></p>`;
    }
    html += `<p style="font-size:13px;">- 응답인원: ${s.respondentCount}명</p>`;
    html += buildScaleTable(s.scale5, '4~5점', showPositive);
    html += buildScaleTable(s.scale10, '7~10점', showPositive);
    html += buildBipolarTable(s.bipolar, true);
    html += buildSelectionTable(s.selection);
    return html;
  }).join('\n');
}

// ============================================================
// 블록 2: 주관식
// ============================================================

function buildCategoryGroup(title, items) {
  if (!items || items.length === 0) return '';
  const subs = items.map(item => {
    const sources = (item.sources || []).map(src =>
      `<li>"${esc(src.text)}" <span class="source">(${esc(src.location)})</span></li>`
    ).join('\n');
    return `<div class="subcategory">
<span class="subcategory-name">- ${esc(item.label)}:</span>
<span class="subcategory-summary"> ${esc(item.summary)}</span>
<details><summary>근거 원문 (${item.sources ? item.sources.length : 0}건)</summary>
<ul class="evidence-area">${sources}</ul>
</details>
</div>`;
  }).join('\n');
  return `<div class="category-group"><div class="category-title">${esc(title)}</div>\n${subs}\n</div>`;
}

function buildByQuestionReview(byQuestion) {
  if (!byQuestion || byQuestion.length === 0) return '';
  return byQuestion.map(q => {
    const patterns = (q.patterns || []).map(p => {
      const sources = (p.sources || []).map(src =>
        `<li>"${esc(src.text)}" <span class="source">(${esc(src.location)})</span></li>`
      ).join('\n');
      return `<div class="subcategory">
<span class="subcategory-name">- ${esc(p.label)}:</span>
<span class="subcategory-summary"> ${esc(p.summary)}</span>
<details><summary>근거 원문 (${p.sources ? p.sources.length : 0}건)</summary>
<ul class="evidence-area">${sources}</ul>
</details>
</div>`;
    }).join('\n');
    return `<div class="pattern-section"><div class="pattern-title">📌 ${esc(q.question)}</div>\n${patterns}\n</div>`;
  }).join('\n');
}

function buildFilteredTables(filtered) {
  if (!filtered) return '';
  let html = '';

  // 1차 제외
  html += '<details style="margin-top:24px;">';
  if (filtered.firstPass && filtered.firstPass.length > 0) {
    const rows = filtered.firstPass.map(f =>
      `<tr><td>"${esc(f.text)}"</td><td>${esc(f.location)}</td><td>${esc(f.reason)}</td></tr>`
    ).join('\n');
    html += `<summary>1차 제외 — 공통 (${filtered.firstPass.length}개)</summary>
<table class="filter-table"><thead><tr><th>원문</th><th>위치</th><th>제외 사유</th></tr></thead>
<tbody>${rows}</tbody></table>`;
  } else {
    html += '<summary>1차 제외 — 공통</summary><p class="note">해당 없음</p>';
  }
  html += '</details>';

  // 교육 외 환경 의견
  html += '<details>';
  if (filtered.facilityOps && filtered.facilityOps.length > 0) {
    const rows = filtered.facilityOps.map(f =>
      `<tr><td>"${esc(f.text)}"</td><td>${esc(f.location)}</td><td>${esc(f.reason)}</td></tr>`
    ).join('\n');
    html += `<summary>교육 외 환경 의견 (${filtered.facilityOps.length}개)</summary>
<table class="filter-table"><thead><tr><th>원문</th><th>위치</th><th>사유</th></tr></thead>
<tbody>${rows}</tbody></table>`;
  } else {
    html += '<summary>교육 외 환경 의견 (시설/식사/주차 등)</summary><p class="note">해당 없음</p>';
  }
  html += '</details>';

  // 2차 제외
  html += '<details>';
  if (filtered.instructorProtection && filtered.instructorProtection.length > 0) {
    const rows = filtered.instructorProtection.map(f =>
      `<tr><td>"${esc(f.text)}"</td><td>${esc(f.location)}</td><td>${esc(f.reason)}</td></tr>`
    ).join('\n');
    html += `<summary>2차 제외 — 강사 보호 (${filtered.instructorProtection.length}개)</summary>
<table class="filter-table"><thead><tr><th>원문</th><th>위치</th><th>제외 사유</th></tr></thead>
<tbody>${rows}</tbody></table>`;
  } else {
    html += '<summary>2차 제외 — 강사 보호</summary><p class="note">해당 없음 — 강사에 대한 과도한 비판 없음</p>';
  }
  html += '</details>';
  html += '<p class="note" style="margin-top:12px;">※ 제외 항목 중 포함시키고 싶은 것이 있으면 말씀해주세요.</p>';
  return html;
}

/** 블록 검토 — 주관식 */
function buildBlock2Review(block2) {
  const hasCategories = ['positive', 'improvement', 'additionalNeeds'].some(k =>
    block2[k] && block2[k].length > 0
  );
  const hasByQ = block2.byQuestion && block2.byQuestion.length > 0;

  // context-notice — 데이터 기반으로 구체적 설명 생성
  let notice = '';
  if (hasCategories && !hasByQ) {
    notice = '포괄적/평가형 문항이므로, 유효 응답을 긍정 의견 / 개선 의견 / 추가 교육 니즈로 분류하여 정리했습니다.';
  } else if (!hasCategories && hasByQ) {
    notice = '구체적/탐색형 문항이므로, 문항별 답변 패턴을 정리했습니다.';
  } else if (hasCategories && hasByQ) {
    const qCount = block2.byQuestion.length;
    notice = `포괄적 문항은 긍정 의견 / 개선 의견 / 추가 교육 니즈로 유형 분류하고, 구체적 문항(${qCount}개)은 문항별 답변 패턴으로 정리했습니다.`;
  } else {
    notice = '주관식 응답을 분석하여 정리했습니다.';
  }
  let html = `<div class="context-notice">${notice}</div>\n`;

  if (hasCategories) {
    if (hasByQ) html += '<div class="category-title">포괄 의견</div>\n';
    html += buildCategoryGroup('긍정 의견', block2.positive);
    html += buildCategoryGroup('개선 의견', block2.improvement);
    html += buildCategoryGroup('추가 교육 니즈', block2.additionalNeeds);
  }
  if (hasByQ) {
    if (hasCategories) html += '<div class="category-title" style="margin-top:24px;">문항별 응답</div>\n';
    html += buildByQuestionReview(block2.byQuestion);
  }
  html += buildFilteredTables(block2.filtered);
  return html;
}

/** 메일 — 주관식 요약 */
function buildBlock2MailSummary(block2) {
  let html = '';
  const cats = [
    { title: '긍정 의견', items: block2.positive },
    { title: '개선 의견', items: block2.improvement },
    { title: '추가 교육 니즈', items: block2.additionalNeeds },
  ];
  for (const cat of cats) {
    if (!cat.items || cat.items.length === 0) continue;
    const lines = cat.items.map(item => `- ${esc(item.label)}: ${esc(item.summary)}`).join('<br>\n');
    html += `<p style="margin-top:16px;font-size:13px;"><strong>${esc(cat.title)}</strong></p>\n<p style="font-size:13px;">${lines}</p>\n`;
  }
  if (block2.byQuestion && block2.byQuestion.length > 0) {
    for (const q of block2.byQuestion) {
      const items = (q.patterns || []).map(p => `- ${esc(p.label)}: ${esc(p.summary)}`).join('<br>\n');
      html += `<p style="margin-top:16px;font-size:13px;"><strong>📌 ${esc(q.question)}</strong></p>\n<p style="font-size:13px;">${items}</p>\n`;
    }
  }
  return html;
}

// ============================================================
// 블록 3/4: 운영진 의견
// ============================================================

function buildSourceTable(sources) {
  if (!sources || sources.length === 0) return '';
  const rows = sources.map(s =>
    `<tr><td>${esc(s.usage)}</td><td>${esc(s.source)}</td><td>${esc(s.location)}</td><td>${esc(s.original)}</td><td>${esc(s.usage)}</td></tr>`
  ).join('\n');
  return `<details><summary>작성 근거</summary>
<table class="source-table"><thead><tr><th>구분</th><th>출처</th><th>위치</th><th>원문</th><th>반영 내용</th></tr></thead>
<tbody>${rows}</tbody></table></details>`;
}

function buildOpinionBlock(label, text, sources) {
  return `<span class="opinion-label">${esc(label)}</span>
<div class="opinion-text">${nl2br(text)}</div>
${buildSourceTable(sources)}`;
}

/** 블록 검토 — 운영진 의견 */
function buildBlock3_4Review(block3, block4) {
  let html = `<div class="context-notice">강의관리 시트의 현장 관찰과 이슈 내용을 바탕으로 초안을 작성했습니다. 수정이 필요하면 말씀해주세요.</div>\n`;
  html += buildOpinionBlock('기업담당자용', block3.text, block3.sources);
  const instructors = (block4 && block4.instructors) || [];
  for (const inst of instructors) {
    const label = inst.group
      ? `강사용 (${inst.instructor} — ${inst.group})`
      : `강사용 (${inst.instructor})`;
    html += `<div style="margin-top:28px;">${buildOpinionBlock(label, inst.text, inst.sources)}</div>\n`;
  }
  return html;
}

/** 메일 — 운영진 의견 본문 */
function buildOpinionMail(text) {
  const paragraphs = String(text).split(/\r?\n/).filter(p => p.trim());
  return `<div class="mail-opinion">\n<p style="font-size:13px;"><strong>[운영진 의견]</strong></p>\n${paragraphs.map(p => `<p style="font-size:13px;">${esc(p)}</p>`).join('\n')}\n</div>`;
}

// ============================================================
// 메일 조립
// ============================================================

function mailSubject(type, instructorName) {
  const company = meta.company || '';
  const course = meta.course || '';
  if (type === 'corp') return `[패스트캠퍼스] ${company} - ${course} 만족도 결과 전달드립니다.`;
  return `[패스트캠퍼스] ${instructorName} 강사님께 - ${company} ${course} 만족도 결과 전달드립니다.`;
}

function mailGreeting(type, instructorName) {
  const date = meta.date || '';
  const course = meta.course || '';
  const company = meta.company || '';
  const rawDataFile = meta.rawDataFileName || '';
  const attachLine = rawDataFile ? `<p style="font-size:13px;">첨부. ${esc(rawDataFile)}</p>` : '';
  if (type === 'corp') {
    return `<p style="margin-bottom:20px;font-size:13px;">담당자님, 안녕하세요!<br>패스트캠퍼스 OOO입니다.</p>
<p style="font-size:13px;">${esc(date)}에 진행된 ${esc(course)}의 만족도 조사 결과 공유드립니다.</p>${attachLine}`;
  }
  return `<p style="margin-bottom:20px;font-size:13px;">${esc(instructorName)} 강사님, 안녕하세요!<br>패스트캠퍼스 OOO입니다.</p>
<p style="font-size:13px;">${esc(date)}에 진행해주신 ${esc(company)} ${esc(course)}의 만족도 설문 결과를 정리하여 전달드립니다.</p>`;
}

function mailClosing(type) {
  if (type === 'corp') {
    return `<p style="margin-top:20px;font-size:13px;">만족도 결과 파일도 참고해보시고, 궁금하시거나 논의 필요한 내용은 추가로 의견 나눠보면 좋을 것 같습니다.</p>
<p style="margin-top:20px;font-size:13px;">감사합니다.<br>OOO 드림</p>`;
  }
  return `<p style="margin-top:20px;font-size:13px;">감사합니다.<br>OOO 드림</p>`;
}

function buildMailContent(type, opinionText, instructorName) {
  let html = mailGreeting(type, instructorName);
  html += '<p style="margin-top:20px;font-size:13px;"><strong>[객관식 설문 결과]</strong></p>\n';
  html += buildBlock1Mail(blocks.block1, type === 'corp');
  html += '<p style="margin-top:24px;font-size:13px;"><strong>[주관식 의견]</strong></p>\n';
  html += buildBlock2MailSummary(blocks.block2);
  html += buildOpinionMail(opinionText);
  html += mailClosing(type);
  return html;
}

function buildCopyButtons(bodyId, fullId) {
  const suffix = bodyId.replace('mail-body-', '');
  return `<div style="margin-top:12px;">
<button class="copy-btn copy-btn-secondary" onclick="copyMail('${bodyId}')">본문 복사</button>
<button class="copy-btn copy-btn-primary" onclick="copyMail('${fullId}')">전체 복사 (제목+본문)</button>
<span id="feedback-body-${suffix}" class="copy-feedback"></span>
<span id="feedback-full-${suffix}" class="copy-feedback"></span>
</div>`;
}

function buildMailSubTab(id, subject, bodyContent) {
  return `<div class="mail-subject" id="mail-subject-${id}">${esc(subject)}</div>
<div id="mail-body-${id}" class="mail-preview" style="font-size:13px;">${bodyContent}</div>
<div id="mail-full-${id}" style="position:absolute;left:-9999px;"><p style="font-size:13px;">${esc(subject)}</p>${bodyContent}</div>
${buildCopyButtons('mail-body-' + id, 'mail-full-' + id)}`;
}

// ============================================================
// 전체 본문 조립
// ============================================================

function buildBody() {
  const instructors = (blocks.block4 && blocks.block4.instructors) || [];
  let html = '';

  // 메인 탭 버튼
  html += `<div class="tabs">
<button class="tab active" onclick="switchTab('review')">블록 검토</button>
<button class="tab" onclick="switchTab('mail')">메일 미리보기</button>
</div>\n`;

  // ===== 블록 검토 탭 =====
  html += '<div id="tab-review" class="tab-content active">\n';
  html += `<div class="review-description">메일에 들어갈 내용을 <strong>객관식 / 주관식 / 운영진 의견</strong> 영역별로 나눠서 보여드립니다.<br>각 영역의 근거 자료(제외 항목, 작성 근거 등)도 함께 확인할 수 있습니다.<br>오른쪽 <strong>메일 미리보기</strong> 탭에서 실제 메일 형태로도 확인해보세요.</div>\n`;
  html += `<div class="guide-banner"><strong>수정이 필요하면 Claude Code 대화창에서 말씀해주세요.</strong><div class="example">예: "운영진 의견 톤 좀 더 부드럽게 해줘", "주관식 이 유형 빼줘", "객관식 표에서 긍정 비율 빼줘"</div></div>\n`;

  // 블록 검토 sub-tabs
  html += `<div class="sub-tabs">
<button class="sub-tab active" onclick="switchSubTab('review','obj')">객관식</button>
<button class="sub-tab" onclick="switchSubTab('review','subj')">주관식</button>
<button class="sub-tab" onclick="switchSubTab('review','opinion')">운영진 의견</button>
</div>\n`;

  html += `<div id="review-obj" class="sub-tab-content active">\n${buildBlock1Review(blocks.block1)}\n</div>\n`;
  html += `<div id="review-subj" class="sub-tab-content">\n${buildBlock2Review(blocks.block2)}\n</div>\n`;
  html += `<div id="review-opinion" class="sub-tab-content">\n${buildBlock3_4Review(blocks.block3, blocks.block4)}\n</div>\n`;
  html += '</div>\n'; // tab-review

  // ===== 메일 미리보기 탭 =====
  html += '<div id="tab-mail" class="tab-content">\n';
  html += `<div class="guide-banner"><strong>수정이 필요하면 Claude Code 대화창에서 말씀해주세요.</strong> 수정 후 이 페이지가 새로 생성됩니다.<br>수정할 내용이 없으면, 아래 <strong>복사 버튼</strong>을 사용하거나 대화창에서 <strong>"임시보관함에 넣어줘"</strong>라고 하면 Gmail 초안으로도 생성됩니다.<div class="example">예: "마무리 멘트 바꿔줘", "객관식 표에서 긍정 비율 빼줘"</div></div>\n`;

  // 메일 sub-tab 버튼
  const instrTabs = instructors.map((inst, i) => {
    const id = i === 0 ? 'instr' : `instr${i}`;
    const label = inst.group
      ? `강사용 (${inst.instructor} — ${inst.group})`
      : `강사용 (${inst.instructor})`;
    return { id, label, inst };
  });

  html += '<div class="sub-tabs">\n';
  html += '<button class="sub-tab active" onclick="switchSubTab(\'mail\',\'corp\')">기업담당자용</button>\n';
  for (const t of instrTabs) {
    html += `<button class="sub-tab" onclick="switchSubTab('mail','${t.id}')">${esc(t.label)}</button>\n`;
  }
  html += '</div>\n';

  // 기업담당자용 메일
  const corpSubject = mailSubject('corp');
  const corpContent = buildMailContent('corp', blocks.block3.text);
  html += `<div id="mail-corp" class="sub-tab-content active">\n${buildMailSubTab('corp', corpSubject, corpContent)}\n</div>\n`;

  // 강사용 메일
  for (const t of instrTabs) {
    const subject = mailSubject('instr', t.inst.instructor);
    const content = buildMailContent('instr', t.inst.text, t.inst.instructor);
    html += `<div id="mail-${t.id}" class="sub-tab-content">\n${buildMailSubTab(t.id, subject, content)}\n</div>\n`;
  }

  html += '</div>\n'; // tab-mail
  return html;
}

// ============================================================
// 실행
// ============================================================

const bodyHtml = buildBody();
fs.writeFileSync(path.resolve(outputPath), bodyHtml, 'utf-8');
console.log(JSON.stringify({
  success: true,
  output: path.resolve(outputPath),
  stats: {
    sheets: Object.keys(blocks.block1).length,
    instructors: (blocks.block4 && blocks.block4.instructors) ? blocks.block4.instructors.length : 0,
    bodyLines: bodyHtml.split('\n').length
  }
}));
