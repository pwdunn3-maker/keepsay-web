const fs = require('fs');
let lines = fs.readFileSync('C:/Users/pwdun/keepsay-web/index.html', 'utf8').split('\n');

// 1. Fix "Legacy vault" language in Pro features (line 276)
const legacyVaultIdx = lines.findIndex(l => l.includes('Legacy vault'));
lines[legacyVaultIdx] = '          <li>Time-locked memories &ndash; sealed until the right moment</li>';

// 2. Add video/AI moment card after line 184 (after the 4th moment card closing div)
const momentGridEndIdx = lines.findIndex(l => l.includes('The moment that sparked another'));
const cardEndIdx = lines.findIndex((l, i) => i > momentGridEndIdx && l.trim() === '</div>');
const cardEnd2Idx = lines.findIndex((l, i) => i > cardEndIdx && l.trim() === '</div>');
lines.splice(cardEnd2Idx + 1, 0,
  '      <div class="moment-card">',
  '        <span class="moment-icon">\uD83C\uDFA5</span>',
  '        <div class="moment-title">Your face. Your voice. Your stories.</div>',
  '        <p class="moment-body">Record video memories and let AI help you find the words for what is hard to express. Keepsay Legacy &mdash; for the stories that deserve more than words.</p>',
  '      </div>'
);

// 3. Replace Memory Book pricing card with Legacy
const memBookStart = lines.findIndex(l => l.includes('pricing-card') && lines[lines.indexOf(l)+1]?.includes('Add-on') || l.includes('"Add-on"'));
// Find by content
let mbStart = -1;
let mbEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Memory Book')) { mbStart = i - 2; }
  if (mbStart !== -1 && lines[i].includes('Coming soon') && lines[i].includes('pricing-btn')) {
    mbEnd = i + 2;
    break;
  }
}

if (mbStart !== -1 && mbEnd !== -1) {
  lines.splice(mbStart, mbEnd - mbStart,
    '      <div class="pricing-card">',
    '        <div class="pricing-badge">Premium</div>',
    '        <div class="pricing-name">Keepsay Legacy</div>',
    '        <div class="pricing-price">$9.99</div>',
    '        <div class="pricing-period">per month &middot; or $79.99/year</div>',
    '        <ul class="pricing-features">',
    '          <li>Everything in Pro</li>',
    '          <li>Video memories &ndash; record yourself telling your stories</li>',
    '          <li>AI writing assist &ndash; find words for what is hard to express</li>',
    '          <li>5GB video storage included</li>',
    '          <li>Full data export anytime</li>',
    '        </ul>',
    '        <a href="https://www.getkeepsay.com/gift" class="pricing-btn">Gift Legacy</a>',
    '      </div>'
  );
  console.log('Replaced Memory Book with Legacy');
}

fs.writeFileSync('C:/Users/pwdun/keepsay-web/index.html', lines.join('\n'), 'utf8');
console.log('Done');
