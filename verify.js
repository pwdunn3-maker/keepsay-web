const fs = require('fs');
const lines = fs.readFileSync('C:/Users/pwdun/keepsay-web/index.html', 'utf8').split('\n');
lines.forEach((l,i) => { if(l.includes('Memory Book') || l.includes('Legacy') || l.includes('Video memories') || l.includes('moment-card')) console.log(i, l); });
