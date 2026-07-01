import fs from 'fs';
import path from 'path';

const file = 'src/main.js';
if (fs.existsSync(file)) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('function initKeyboardShortcuts')) {
      console.log(`[Line ${idx+1}]: ${line.trim()}`);
    }
  });
}
