const fs = require('fs');
let lines = fs.readFileSync('C:/Users/pwdun/keepsay-web/gift.html', 'utf8').split('\n');

// 1. Fix duration-save span to have an id so JS can update it
const durationSaveIdx = lines.findIndex(l => l.includes('duration-save') && l.includes('Save up to 42%'));
lines[durationSaveIdx] = '            <span class="duration-save" id="duration-save-label">Save 42%</span>';

// 2. Improve duration toggle active state in CSS
const durationBtnActiveIdx = lines.findIndex(l => l.includes('.duration-btn.active {'));
lines[durationBtnActiveIdx] = '    .duration-btn.active { background: var(--green); color: #fff; font-weight: 600; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }';

// 3. Update updateUI function to also update savings label
const updateUIEndIdx = lines.findIndex(l => l.includes("selectedTier === 'pro' ? PRO_FEATURES : LEGACY_FEATURES;"));
lines.splice(updateUIEndIdx + 1, 0, '');
lines.splice(updateUIEndIdx + 2, 0, '      const saveLabel = document.getElementById(\'duration-save-label\');');
lines.splice(updateUIEndIdx + 3, 0, '      if (saveLabel) saveLabel.textContent = selectedTier === \'legacy\' ? \'Save 33%\' : \'Save 42%\';');

fs.writeFileSync('C:/Users/pwdun/keepsay-web/gift.html', lines.join('\n'), 'utf8');
console.log('Done');
