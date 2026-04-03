/**
 * generate-shell.js — HTML 셸 생성 + 조립 스크립트
 *
 * [모드 1: 셸 반환] (기존)
 *   node scripts/generate-shell.js "리포트 제목"
 *   → JSON { head, tail, reviewHeader, mailHeader } 출력
 *
 * [모드 2: HTML 조립] (신규)
 *   node scripts/generate-shell.js "리포트 제목" "본문파일경로" "출력파일경로"
 *   → 본문 파일을 읽어 head + 본문 + tail을 합친 최종 HTML을 출력 파일로 저장
 *   → LLM은 CSS/JS를 작성하지 않고, 본문만 Write한 뒤 이 명령으로 조립
 */

const fs = require('fs');
const path = require('path');

const title = process.argv[2] || '만족도 리포팅 결과';
const bodyFilePath = process.argv[3] || null;
const outputFilePath = process.argv[4] || null;
const metaFilePath = process.argv[5] || null;

// --- HTML entity 이스케이프 ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// --- meta.json → 헤더 HTML 생성 ---
function buildHeader(meta) {
  const parts = [];
  if (meta.date) parts.push(meta.date);
  if (meta.instructor) {
    const name = meta.instructor;
    parts.push(name.includes('강사') ? name : name + ' 강사');
  }
  if (meta.respondents) parts.push(meta.respondents + '명 응답');
  const subtitle = parts.join(' | ');

  let html = '    <div class="header-area">\n';
  if (meta.company) {
    html += '      <div class="company-name">' + escapeHtml(meta.company) + '</div>\n';
  }
  if (meta.course) {
    html += '      <h1>' + escapeHtml(meta.course) + '</h1>\n';
  }
  if (subtitle) {
    html += '      <div class="subtitle">' + escapeHtml(subtitle) + '</div>\n';
  }
  html += '    </div>\n';
  return html;
}

// --- meta.json → hidden 필드 HTML 생성 ---
function buildHiddenFields(meta) {
  const metaForHidden = {
    company: meta.company || '',
    course: meta.course || '',
    date: meta.date || '',
    instructor: meta.instructor || '',
    respondents: meta.respondents || '',
    omName: meta.omName || '',
  };
  const phase5Text = Array.isArray(meta.phase5Log)
    ? meta.phase5Log.join(' / ')
    : '';

  let html = '\n    <!-- GAS 연동용 hidden 데이터 -->\n';
  html += '    <div style="display:none;">\n';
  html += "      <input type=\"hidden\" id=\"hidden-meta\" value='" + escapeHtml(JSON.stringify(metaForHidden)) + "' />\n";
  html += '      <input type="hidden" id="hidden-start-time" value="' + escapeHtml(meta.pluginStartTime || '') + '" />\n';
  html += '      <input type="hidden" id="hidden-html-created-time" value="' + escapeHtml(meta.htmlCreatedTime || '') + '" />\n';
  html += '      <input type="hidden" id="hidden-phase5" value="' + escapeHtml(phase5Text) + '" />\n';
  html += '    </div>\n';
  return html;
}

const head = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 900px; margin: 20px auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 30px; }
    .header-area { margin-bottom: 24px; }
    .company-name { font-size: 16px; color: #4A90D9; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .subtitle { color: #888; font-size: 13px; }
    h2 { font-size: 18px; margin: 25px 0 10px; padding-bottom: 8px; border-bottom: 2px solid #4A90D9; color: #4A90D9; }
    h3 { font-size: 15px; margin: 20px 0 8px; color: #555; }
    .guide-banner { padding: 12px 16px; background: #FFF8E1; border: 1px solid #FFE082; border-radius: 6px; margin-bottom: 20px; font-size: 13px; line-height: 1.7; color: #5D4037; }
    .guide-banner strong { color: #E65100; }
    .guide-banner .example { color: #888; font-size: 12px; margin-top: 4px; }
    .review-description { padding: 12px 16px; background: #F3F6FB; border-radius: 6px; margin-bottom: 12px; font-size: 13px; line-height: 1.7; color: #555; }
    .context-notice { padding: 8px 0 12px 0; margin-bottom: 8px; font-size: 13px; line-height: 1.7; color: #1A5276; font-weight: 500; }
    .tabs { display: flex; gap: 0; margin-bottom: 20px; border-bottom: 2px solid #ddd; }
    .tab { padding: 10px 24px; border: none; background: none; cursor: pointer; font-size: 14px; color: #888; border-bottom: 2px solid transparent; margin-bottom: -2px; }
    .tab.active { color: #4A90D9; border-bottom-color: #4A90D9; font-weight: bold; }
    .tab:hover { color: #4A90D9; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .sub-tabs { display: flex; gap: 0; margin-bottom: 16px; border-bottom: 1px solid #e0e0e0; }
    .sub-tab { padding: 8px 18px; border: none; background: none; cursor: pointer; font-size: 13px; color: #999; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .sub-tab.active { color: #333; border-bottom-color: #4A90D9; font-weight: 600; }
    .sub-tab:hover { color: #555; }
    .sub-tab-content { display: none; }
    .sub-tab-content.active { display: block; }
    .respondent-count { color: #666; margin-bottom: 15px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; }
    th { background: #f0f4f8; padding: 8px 10px; text-align: left; border: 1px solid #ddd; font-weight: 600; }
    td { padding: 8px 10px; border: 1px solid #eee; }
    tr:hover { background: #f8f9fa; }
    .category-group { margin: 16px 0; }
    .category-title { font-size: 15px; font-weight: 700; color: #333; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #4A90D9; }
    .subcategory { margin: 8px 0 8px 8px; font-size: 13px; }
    .subcategory-name { font-weight: 600; color: #333; }
    .subcategory-summary { color: #444; font-size: 13px; line-height: 1.6; }
    .opinion-text { padding: 12px 16px; background: #f8f9fa; border-left: 3px solid #4A90D9; margin: 8px 0; font-size: 13px; line-height: 1.8; }
    .opinion-label { display: inline-block; padding: 3px 10px; background: #E3F2FD; color: #1565C0; border-radius: 3px; font-size: 12px; font-weight: 600; margin-bottom: 8px; }
    details { margin: 10px 0; }
    summary { cursor: pointer; color: #4A90D9; font-size: 13px; padding: 5px 0; }
    summary:hover { text-decoration: underline; }
    .evidence-area { margin: 6px 0 12px 16px; padding: 10px 14px; background: #f9fafb; border-left: 2px solid #d0d7de; border-radius: 0 4px 4px 0; font-size: 12px; color: #555; }
    .evidence-area li { padding: 4px 0; line-height: 1.6; list-style: none; }
    .evidence-area .source { color: #888; font-size: 11px; }
    .filter-table { margin: 10px 0; font-size: 12px; }
    .filter-table th { background: #f5f5f5; font-size: 12px; }
    .filter-table td { font-size: 12px; }
    .mail-preview { padding: 20px; border: 1px solid #ddd; border-radius: 4px; background: #fff; font-size: 13px; line-height: 1.8; }
    .mail-preview table { margin: 10px 0; }
    .mail-opinion { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e0e0e0; }
    .copy-btn { margin-top: 10px; padding: 10px 24px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    .copy-btn-primary { background: #4A90D9; color: #fff; }
    .copy-btn-primary:hover { background: #357ABD; }
    .copy-btn-secondary { background: #e8e8e8; color: #333; }
    .copy-btn-secondary:hover { background: #d0d0d0; }
    .copy-feedback { margin-left: 10px; color: #4CAF50; font-size: 13px; }
    .source-table { margin: 10px 0; font-size: 12px; }
    .source-table th { background: #f0f4f8; font-size: 12px; }
    .source-table td { font-size: 12px; vertical-align: top; }
    .pattern-section { margin: 16px 0; }
    .pattern-title { font-size: 14px; font-weight: 600; color: #333; margin-bottom: 8px; }
    .pattern-item { margin: 4px 0 4px 16px; font-size: 13px; color: #444; }
    .pattern-count { color: #888; font-size: 12px; }
    .note { font-size: 12px; color: #888; margin: 4px 0; font-style: italic; }
    .bipolar-dist { font-size: 12px; color: #666; margin-top: 4px; }
    .mail-subject { font-size: 14px; font-weight: 600; color: #333; padding-bottom: 12px; margin-bottom: 16px; border-bottom: 1px solid #ddd; }
  </style>
</head>
<body>
  <div class="container">`;

const tail = `  </div>

  <script>
    const GAS_URL = "https://script.google.com/macros/s/AKfycbwYga1AtkZIQIzo5Gm_h3lMblxXcnpSkDGztCB3P9fjBpLP1Y0BA1CMoDoCdOd76ag/exec";
    let _gasSent = false;

    function sendDataToSheet() {
      if (_gasSent) return;
      var metaEl = document.getElementById("hidden-meta");
      if (!metaEl) return;
      _gasSent = true;

      var metaData = JSON.parse(metaEl.value);
      var startTime = (document.getElementById("hidden-start-time") || {}).value || "";
      var htmlCreatedTime = (document.getElementById("hidden-html-created-time") || {}).value || "";
      var phase5Log = (document.getElementById("hidden-phase5") || {}).value || "";
      var now = new Date(Date.now() + 9 * 60 * 60 * 1000);
      var copyClickTime = now.toISOString().slice(0, 16).replace('T', ' ');

      fetch(GAS_URL, {
        method: "POST",
        body: JSON.stringify({
          startTime: startTime,
          htmlCreatedTime: htmlCreatedTime,
          copyClickTime: copyClickTime,
          company: metaData.company || "",
          course: metaData.course || "",
          date: metaData.date || "",
          instructor: metaData.instructor || "",
          respondents: metaData.respondents || "",
          omName: metaData.omName || "",
          modified: "",
          modifiedAreas: "",
          phase5Log: phase5Log
        })
      }).catch(function() {});
    }

    function switchTab(tabName) {
      document.querySelectorAll('.tabs > .tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-' + tabName).classList.add('active');
      event.target.classList.add('active');
    }
    function switchSubTab(parentTab, subTabName) {
      const parent = document.getElementById('tab-' + parentTab);
      parent.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
      parent.querySelectorAll('.sub-tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById(parentTab + '-' + subTabName).classList.add('active');
      event.target.classList.add('active');
    }
    function copyMail(elementId) {
      const el = document.getElementById(elementId);
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('copy');
      selection.removeAllRanges();
      const parts = elementId.split('-');
      const lastPart = parts.slice(1).join('-');
      const feedbackId = 'feedback-' + lastPart;
      const feedback = document.getElementById(feedbackId);
      if (feedback) { feedback.textContent = '복사 완료!'; setTimeout(() => { feedback.textContent = ''; }, 2000); }
      sendDataToSheet();
    }
  </script>
</body>
</html>`;

const reviewHeader = `      <div class="review-description">
        메일에 들어갈 내용을 <strong>객관식 / 주관식 / 운영진 의견</strong> 영역별로 나눠서 보여드립니다.<br>
        각 영역의 근거 자료(제외 항목, 작성 근거 등)도 함께 확인할 수 있습니다.<br>
        오른쪽 <strong>메일 미리보기</strong> 탭에서 실제 메일 형태로도 확인해보세요.
      </div>
      <div class="guide-banner">
        <strong>수정이 필요하면 Claude Code 대화창에서 말씀해주세요.</strong>
        <div class="example">예: "운영진 의견 톤 좀 더 부드럽게 해줘", "주관식 이 유형 빼줘", "객관식 표에서 긍정 비율 빼줘"</div>
      </div>`;

const mailHeader = `      <div class="guide-banner">
        <strong>수정이 필요하면 Claude Code 대화창에서 말씀해주세요.</strong> 수정 후 이 페이지가 새로 생성됩니다.<br>
        수정할 내용이 없으면, 아래 <strong>복사 버튼</strong>을 사용하거나 대화창에서 <strong>"임시보관함에 넣어줘"</strong>라고 하면 Gmail 초안으로도 생성됩니다.
        <div class="example">예: "마무리 멘트 바꿔줘", "객관식 표에서 긍정 비율 빼줘"</div>
      </div>`;

// 모드 분기
if (bodyFilePath && outputFilePath) {
  // 모드 2: HTML 조립
  try {
    const body = fs.readFileSync(bodyFilePath, 'utf-8');

    let headerHtml = '';
    let hiddenHtml = '';

    if (metaFilePath && fs.existsSync(metaFilePath)) {
      const meta = JSON.parse(fs.readFileSync(metaFilePath, 'utf-8'));

      // htmlCreatedTime을 현재 시점으로 갱신하고 meta.json에 저장
      const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      meta.htmlCreatedTime = nowKst.toISOString().slice(0, 16).replace('T', ' ');
      fs.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');

      headerHtml = buildHeader(meta);
      hiddenHtml = buildHiddenFields(meta);
    }

    const html = head + '\n' + headerHtml + body + '\n' + hiddenHtml + tail;
    fs.writeFileSync(outputFilePath, html, 'utf-8');
    console.log(JSON.stringify({
      success: true,
      outputPath: outputFilePath,
      reviewHeader,
      mailHeader,
    }));
  } catch (err) {
    console.error(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  }
} else {
  // 모드 1: 셸 반환 (기존)
  console.log(JSON.stringify({ head, tail, reviewHeader, mailHeader }));
}
