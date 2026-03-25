/**
 * generate-shell.js — HTML 셸 생성 스크립트
 *
 * 고정 부분(CSS/JS/안내문구)을 head/tail로 분리하여 반환한다.
 * LLM은 head와 tail 사이에 가변 본문만 Write하면 된다.
 *
 * 사용법:
 *   node scripts/generate-shell.js "리포트 제목"
 *
 * 출력: JSON — { head, tail }
 *   head: <!DOCTYPE html> ~ <div class="container"> 직후까지 (CSS 포함)
 *   tail: </div> ~ </html> (JS 포함)
 */

const title = process.argv[2] || '만족도 리포팅 결과';

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
    .copy-btn { margin-top: 10px; padding: 10px 24px; background: #4A90D9; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    .copy-btn:hover { background: #357ABD; }
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
  </style>
</head>
<body>
  <div class="container">`;

const tail = `  </div>

  <script>
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
    }
  </script>
</body>
</html>`;

console.log(JSON.stringify({ head, tail }));
