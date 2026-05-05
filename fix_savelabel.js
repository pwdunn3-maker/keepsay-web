const fs = require('fs');
let lines = fs.readFileSync('C:/Users/pwdun/keepsay-web/gift.html', 'utf8').split('\n');
const saveLabelIdx = lines.findIndex(l => l.includes('.duration-save {'));
lines[saveLabelIdx] = '    .duration-save { font-size: 11px; color: rgba(255,255,255,0.8); font-weight: 500; display: block; margin-top: 2px; }';
fs.writeFileSync('C:/Users/pwdun/keepsay-web/gift.html', lines.join('\n'), 'utf8');
console.log('Done');
