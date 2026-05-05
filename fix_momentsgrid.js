const fs = require('fs');
let lines = fs.readFileSync('C:/Users/pwdun/keepsay-web/index.html', 'utf8').split('\n');

// Replace the moments-grid with a cleaner approach
lines[56] = '    .moments-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }';

// Add style to card 4 and 5 to span and center
lines[182] = '      <div class="moment-card" style="grid-column: 1; grid-row: 2;">';
lines[188] = '      <div class="moment-card" style="grid-column: 2; grid-row: 2;">';

fs.writeFileSync('C:/Users/pwdun/keepsay-web/index.html', lines.join('\n'), 'utf8');
console.log('Done');
