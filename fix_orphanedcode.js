const fs = require('fs');
let lines = fs.readFileSync('C:/Users/pwdun/keepsay-web/gift.html', 'utf8').split('\n');

// Remove orphaned legacy-submit-btn lines
for (let i = 395; i < 405; i++) {
  if (lines[i] && lines[i].includes('legacy-submit-btn')) {
    console.log('Found at line', i, ':', lines[i]);
    lines[i] = '';
  }
  if (lines[i] && lines[i].includes('btn.disabled = true')) {
    console.log('Found at line', i, ':', lines[i]);
    lines[i] = '';
  }
  if (lines[i] && lines[i].includes("btn.textContent = 'Joining...'")) {
    console.log('Found at line', i, ':', lines[i]);
    lines[i] = '';
  }
}

fs.writeFileSync('C:/Users/pwdun/keepsay-web/gift.html', lines.join('\n'), 'utf8');
console.log('Done');
