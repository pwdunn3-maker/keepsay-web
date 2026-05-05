const fs = require('fs');
let lines = fs.readFileSync('C:/Users/pwdun/keepsay-web/gift.html', 'utf8').split('\n');

// Fix LEGACY_FEATURES - replace lines 327-335 with correct const
lines.splice(327, 9,
  '    const LEGACY_FEATURES = `',
  '      <div class="feature-row"><span class="feature-icon">\uD83C\uDFA5</span><span class="feature-text">Video memories \u2014 record yourself telling the stories only you can tell</span></div>',
  '      <div class="feature-row"><span class="feature-icon">\uD83E\uDD16</span><span class="feature-text">AI writing assist \u2014 find words for what is hard to express</span></div>',
  '      <div class="feature-row"><span class="feature-icon">\uD83D\uDCBE</span><span class="feature-text">Generous video storage \u2014 5GB included, add more anytime for $1.99/mo</span></div>',
  '      <div class="feature-row"><span class="feature-icon">\uD83C\uDFA4</span><span class="feature-text">Unlimited voice recordings \u2014 their voice, preserved forever</span></div>',
  '      <div class="feature-row"><span class="feature-icon">\uD83D\uDCF8</span><span class="feature-text">Unlimited photo memories with secure cloud backup</span></div>',
  '      <div class="feature-row"><span class="feature-icon">\uD83D\uDD12</span><span class="feature-text">Time-locked memories \u2014 sealed until the perfect moment to open</span></div>',
  '      <div class="feature-row"><span class="feature-icon">\uD83C\uDF3F</span><span class="feature-text">Family Circles \u2014 share with the whole family at once</span></div>',
  '      <div class="feature-row"><span class="feature-icon">\uD83D\uDCE6</span><span class="feature-text">Full data export \u2014 their memories are always theirs</span></div>',
  '    `;'
);

// Re-read to get updated line numbers then fix orphaned JS
let content = lines.join('\n');

// Remove orphaned waitlist code block
const orphanStart = content.indexOf('      try {\n        await fetch(\'/api/legacy-waitlist\'');
const orphanEnd = content.indexOf('document.getElementById(\'legacy-success\').style.display = \'block\';\n    }');
if (orphanStart !== -1 && orphanEnd !== -1) {
  content = content.substring(0, orphanStart) + content.substring(orphanEnd + 'document.getElementById(\'legacy-success\').style.display = \'block\';\n    }'.length);
  console.log('Removed orphaned waitlist JS');
}

fs.writeFileSync('C:/Users/pwdun/keepsay-web/gift.html', content, 'utf8');
console.log('Done');
