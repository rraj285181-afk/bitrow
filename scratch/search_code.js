import fs from 'fs';
import path from 'path';

const filePath = path.join('node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.development.mjs');

if (!fs.existsSync(filePath)) {
  console.log("File not found:", filePath);
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');

// Find all matches of class names in styles or JS strings
const matches = content.match(/tv-[a-zA-Z0-9_-]+/g);
if (matches) {
  const uniqueMatches = Array.from(new Set(matches));
  console.log("Found tv- classes:", uniqueMatches);
} else {
  console.log("No tv- classes found.");
}
