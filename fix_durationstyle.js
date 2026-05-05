const fs = require('fs');
let lines = fs.readFileSync('C:/Users/pwdun/keepsay-web/gift.html', 'utf8').split('\n');

// Fix duration toggle container - white background instead of warm gray
const toggleIdx = lines.findIndex(l => l.includes('.duration-toggle {'));
lines[toggleIdx] = '    .duration-toggle { display: flex; background: #fff; border-radius: 12px; padding: 4px; gap: 4px; border: 1.5px solid var(--border); }';

// Fix inactive duration button - white background
const btnIdx = lines.findIndex(l => l.includes('.duration-btn {'));
lines[btnIdx] = '    .duration-btn { flex: 1; padding: 10px; text-align: center; border-radius: 9px; border: none; background: #fff; cursor: pointer; font-family: \'Inter\', sans-serif; font-size: 14px; font-weight: 500; color: var(--text-secondary); transition: all 0.2s; }';

// Fix active duration button - match tier card selected style
const activeBtnIdx = lines.findIndex(l => l.includes('.duration-btn.active {'));
lines[activeBtnIdx] = '    .duration-btn.active { background: var(--green-light); color: var(--green); font-weight: 600; border: 1.5px solid var(--green); }';

// Fix save label color back to gold since background is now green-light not green
const saveLabelIdx = lines.findIndex(l => l.includes('.duration-save {'));
lines[saveLabelIdx] = '    .duration-save { font-size: 11px; color: var(--green); font-weight: 500; display: block; margin-top: 2px; opacity: 0.7; }';

fs.writeFileSync('C:/Users/pwdun/keepsay-web/gift.html', lines.join('\n'), 'utf8');
console.log('Done');
