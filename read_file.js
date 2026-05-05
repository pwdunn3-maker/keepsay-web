const fs = require('fs');
let lines = fs.readFileSync('C:/Users/pwdun/keepsay-web/index.html', 'utf8').split('\n');

// Find the moments grid closing div and all 5 cards
let cardStarts = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('class="moment-card"')) cardStarts.push(i);
}
console.log('Card starts:', cardStarts);
