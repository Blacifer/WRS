/**
 * Realistic Caliper Display Image Generator for E2E Test Fixtures
 * Indian Railways WRS Raipur Spring Classification System
 *
 * Generates high-fidelity SVG and BMP/PNG images simulating a digital caliper's
 * 7-segment LCD screen displaying exact millimeter readings.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 7-segment mapping: a=top, b=top-right, c=bottom-right, d=bottom, e=bottom-left, f=top-left, g=middle
const SEGMENT_MAP = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'e', 'd', 'c', 'g'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  '-': ['g'],
  ' ': []
};

/**
 * Generate 7-segment SVG digit
 */
function render7SegmentDigit(char, x, y, width = 36, height = 64) {
  const activeSegments = SEGMENT_MAP[char] || [];
  const t = 6; // thickness
  const w = width;
  const h = height;
  const midY = y + h / 2;

  const segments = {
    a: `M ${x + t} ${y} L ${x + w - t} ${y} L ${x + w - 2*t} ${y + t} L ${x + 2*t} ${y + t} Z`,
    b: `M ${x + w} ${y + t} L ${x + w} ${midY - t/2} L ${x + w - t} ${midY - t} L ${x + w - t} ${y + 2*t} Z`,
    c: `M ${x + w} ${midY + t/2} L ${x + w} ${y + h - t} L ${x + w - t} ${y + h - 2*t} L ${x + w - t} ${midY + t} Z`,
    d: `M ${x + t} ${y + h} L ${x + w - t} ${y + h} L ${x + w - 2*t} ${y + h - t} L ${x + 2*t} ${y + h - t} Z`,
    e: `M ${x} ${midY + t/2} L ${x} ${y + h - t} L ${x + t} ${y + h - 2*t} L ${x + t} ${midY + t} Z`,
    f: `M ${x} ${y + t} L ${x} ${midY - t/2} L ${x + t} ${midY - t} L ${x + t} ${y + 2*t} Z`,
    g: `M ${x + t} ${midY} L ${x + 2*t} ${midY - t/2} L ${x + w - 2*t} ${midY - t/2} L ${x + w - t} ${midY} L ${x + w - 2*t} ${midY + t/2} L ${x + 2*t} ${midY + t/2} Z`
  };

  let svg = `<g class="digit-${char}">`;
  for (const [segName, pathD] of Object.entries(segments)) {
    const isActive = activeSegments.includes(segName);
    const color = isActive ? '#0f172a' : '#94a3b830'; // active black-slate, inactive ghost
    svg += `\n  <path d="${pathD}" fill="${color}" />`;
  }
  svg += `\n</g>`;
  return svg;
}

/**
 * Generate full SVG caliper image for a given numeric reading
 */
export function generateCaliperSvg(valueStr, options = {}) {
  const width = options.width || 480;
  const height = options.height || 260;
  const brand = options.brand || 'MITUTOYO / DIGIMATIC CALIPER';

  // Format reading e.g. "260.00"
  const formatted = typeof valueStr === 'number' ? valueStr.toFixed(2) : valueStr;
  const parts = formatted.split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1] || '00';

  let digitsSvg = '';
  let curX = 110;
  const startY = 95;
  const digitWidth = 38;
  const digitGap = 10;

  // Render integer part digits
  for (const char of integerPart) {
    digitsSvg += render7SegmentDigit(char, curX, startY, digitWidth, 68);
    curX += digitWidth + digitGap;
  }

  // Render decimal point
  const dotX = curX + 2;
  const dotY = startY + 68 - 10;
  digitsSvg += `\n<circle cx="${dotX}" cy="${dotY}" r="4.5" fill="#0f172a" />`;
  curX += 16;

  // Render decimal digits
  for (const char of decimalPart) {
    digitsSvg += render7SegmentDigit(char, curX, startY, digitWidth, 68);
    curX += digitWidth + digitGap;
  }

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="caliperMetal" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#475569" />
      <stop offset="40%" stop-color="#334155" />
      <stop offset="70%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="lcdBezel" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="lcdGlass" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#b4c6a6" />
      <stop offset="10%" stop-color="#c8d6bc" />
      <stop offset="90%" stop-color="#b0c2a2" />
      <stop offset="100%" stop-color="#9eb090" />
    </linearGradient>
    <filter id="lcdInnerShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="1" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.3"/>
    </filter>
  </defs>

  <!-- Caliper Metallic Housing -->
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="16" fill="url(#caliperMetal)" stroke="#64748b" stroke-width="3" />
  
  <!-- Caliper Scale Beam (Stainless Steel) -->
  <rect x="0" y="70" width="35" height="120" fill="#94a3b8" stroke="#475569" stroke-width="1.5" />
  <line x1="10" y1="80" x2="30" y2="80" stroke="#334155" stroke-width="1.5" />
  <line x1="15" y1="95" x2="30" y2="95" stroke="#334155" stroke-width="1" />
  <line x1="10" y1="110" x2="30" y2="110" stroke="#334155" stroke-width="1.5" />
  <line x1="15" y1="125" x2="30" y2="125" stroke="#334155" stroke-width="1" />
  <line x1="10" y1="140" x2="30" y2="140" stroke="#334155" stroke-width="1.5" />
  <line x1="15" y1="155" x2="30" y2="155" stroke="#334155" stroke-width="1" />
  <line x1="10" y1="170" x2="30" y2="170" stroke="#334155" stroke-width="1.5" />

  <!-- Caliper Branding / Details -->
  <text x="50" y="52" fill="#e2e8f0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" letter-spacing="1">${brand}</text>
  <text x="${width - 160}" y="52" fill="#94a3b8" font-family="monospace" font-size="11">WRS RAIPUR CAL-04</text>

  <!-- LCD Screen Housing & Bezel -->
  <rect x="70" y="68" width="${width - 140}" height="124" rx="8" fill="url(#lcdBezel)" stroke="#020617" stroke-width="2" />
  <rect x="80" y="76" width="${width - 160}" height="108" rx="4" fill="url(#lcdGlass)" filter="url(#lcdInnerShadow)" />

  <!-- Caliper Status Indicators on LCD -->
  <text x="96" y="98" fill="#1e293b" font-family="Arial, sans-serif" font-size="11" font-weight="bold">INC</text>
  <text x="${width - 115}" y="152" fill="#0f172a" font-family="Arial, sans-serif" font-size="18" font-weight="bold">mm</text>

  <!-- Rendered Digits -->
  ${digitsSvg}

  <!-- Physical Buttons on Caliper Body -->
  <g transform="translate(100, 204)">
    <!-- ZERO/ABS Button -->
    <rect x="0" y="0" width="70" height="22" rx="4" fill="#eab308" stroke="#ca8a04" stroke-width="1" />
    <text x="14" y="15" fill="#000000" font-family="sans-serif" font-size="10" font-weight="bold">ORIGIN</text>
    
    <!-- mm/inch Button -->
    <rect x="90" y="0" width="60" height="22" rx="4" fill="#3b82f6" stroke="#2563eb" stroke-width="1" />
    <text x="100" y="15" fill="#ffffff" font-family="sans-serif" font-size="10" font-weight="bold">in/mm</text>

    <!-- ON/OFF Button -->
    <rect x="170" y="0" width="60" height="22" rx="4" fill="#ef4444" stroke="#dc2626" stroke-width="1" />
    <text x="180" y="15" fill="#ffffff" font-family="sans-serif" font-size="10" font-weight="bold">ON/OFF</text>
    
    <!-- Thumb Roller -->
    <rect x="250" y="-4" width="40" height="28" rx="2" fill="#64748b" stroke="#334155" />
    <line x1="256" y1="-2" x2="256" y2="22" stroke="#1e293b" stroke-width="1" />
    <line x1="262" y1="-2" x2="262" y2="22" stroke="#1e293b" stroke-width="1" />
    <line x1="268" y1="-2" x2="268" y2="22" stroke="#1e293b" stroke-width="1" />
    <line x1="274" y1="-2" x2="274" y2="22" stroke="#1e293b" stroke-width="1" />
    <line x1="280" y1="-2" x2="280" y2="22" stroke="#1e293b" stroke-width="1" />
  </g>
</svg>`;

  return svgContent;
}

/**
 * Generate 24-bit uncompressed Windows BMP file Buffer (standard, zero-dependency image format)
 * Allows testing OCR and binary image loading without native C++ canvas dependencies
 */
export function generateCaliperBmpBuffer(valueStr, width = 360, height = 160) {
  // Simple bitmap rendering for LCD digit test
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;

  const buffer = Buffer.alloc(fileSize);

  // Bitmap File Header
  buffer.write('BM', 0);
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(0, 6); // Reserved
  buffer.writeUInt32LE(54, 10); // Offset to pixel data

  // DIB Header (BITMAPINFOHEADER)
  buffer.writeUInt32LE(40, 14); // Header size
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26); // Color planes
  buffer.writeUInt16LE(24, 28); // Bits per pixel
  buffer.writeUInt32LE(0, 30); // Compression (BI_RGB)
  buffer.writeUInt32LE(pixelArraySize, 34);
  buffer.writeInt32LE(2835, 38); // 72 DPI
  buffer.writeInt32LE(2835, 42); // 72 DPI
  buffer.writeUInt32LE(0, 46); // Palette colors
  buffer.writeUInt32LE(0, 50); // Important colors

  // Background color: LCD pale olive green #c8d6bc -> B=188, G=214, R=200
  const bgB = 188;
  const bgG = 214;
  const bgR = 200;

  // Dark segment color: #0f172a -> B=42, G=23, R=15
  const fgB = 42;
  const fgG = 23;
  const fgR = 15;

  // Initialize background
  for (let y = 0; y < height; y++) {
    const rowOffset = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const p = rowOffset + x * 3;
      // Caliper bezel on border
      if (x < 15 || x > width - 15 || y < 15 || y > height - 15) {
        buffer[p] = 50; // Dark grey bezel
        buffer[p + 1] = 50;
        buffer[p + 2] = 50;
      } else {
        buffer[p] = bgB;
        buffer[p + 1] = bgG;
        buffer[p + 2] = bgR;
      }
    }
  }

  // Draw 7-segment digits into buffer
  const formatted = typeof valueStr === 'number' ? valueStr.toFixed(2) : valueStr;
  let curX = 30;
  const dWidth = 32;
  const dHeight = 64;
  const dY = 50; // Distance from bottom (since BMP rows are bottom-to-top)

  for (let i = 0; i < formatted.length; i++) {
    const char = formatted[i];
    if (char === '.') {
      // Draw decimal dot
      const dotX = curX + 2;
      const dotY = dY;
      for (let dy = 0; dy < 6; dy++) {
        for (let dx = 0; dx < 6; dx++) {
          const px = dotX + dx;
          const py = dotY + dy;
          const p = 54 + py * rowSize + px * 3;
          buffer[p] = fgB;
          buffer[p + 1] = fgG;
          buffer[p + 2] = fgR;
        }
      }
      curX += 16;
      continue;
    }

    const segs = SEGMENT_MAP[char] || [];
    const t = 6; // segment thickness

    // Helper to draw filled rectangle in bitmap
    const drawRect = (rx, ry, rw, rh) => {
      for (let dy = 0; dy < rh; dy++) {
        for (let dx = 0; dx < rw; dx++) {
          const px = rx + dx;
          const py = ry + dy;
          if (px >= 0 && px < width && py >= 0 && py < height) {
            const p = 54 + py * rowSize + px * 3;
            buffer[p] = fgB;
            buffer[p + 1] = fgG;
            buffer[p + 2] = fgR;
          }
        }
      }
    };

    const midY = dY + dHeight / 2;

    // Segment 'a' (top)
    if (segs.includes('a')) drawRect(curX + t, dY + dHeight - t, dWidth - 2 * t, t);
    // Segment 'b' (top-right)
    if (segs.includes('b')) drawRect(curX + dWidth - t, midY, t, dHeight / 2);
    // Segment 'c' (bottom-right)
    if (segs.includes('c')) drawRect(curX + dWidth - t, dY, t, dHeight / 2);
    // Segment 'd' (bottom)
    if (segs.includes('d')) drawRect(curX + t, dY, dWidth - 2 * t, t);
    // Segment 'e' (bottom-left)
    if (segs.includes('e')) drawRect(curX, dY, t, dHeight / 2);
    // Segment 'f' (top-left)
    if (segs.includes('f')) drawRect(curX, midY, t, dHeight / 2);
    // Segment 'g' (middle)
    if (segs.includes('g')) drawRect(curX + t, midY - t / 2, dWidth - 2 * t, t);

    curX += dWidth + 14;
  }

  return buffer;
}

// Generate the 7 specified realistic test fixtures
export const FIXTURE_SPECS = [
  { filename: 'caliper_260_00', value: 260.00, desc: 'CASNUB 22 NLB Outer Used Band I (exact 260.00mm boundary)' },
  { filename: 'caliper_257_50', value: 257.50, desc: 'CASNUB 22 NLB Outer Used Band II (midpoint 257.50mm)' },
  { filename: 'caliper_248_00', value: 248.00, desc: 'CASNUB 22 NLB Outer Used Band V/VI boundary (248.00mm)' },
  { filename: 'caliper_294_00', value: 294.00, desc: 'CASNUB 22 NLB Snubber Used Band I/II boundary (294.00mm)' },
  { filename: 'caliper_305_20', value: 305.20, desc: 'CASNUB 22 RFT Snubber Used Band I (305.20mm)' },
  { filename: 'caliper_241_30', value: 241.30, desc: 'CASNUB 22 HS Inner Used Band II (241.30mm)' },
  { filename: 'caliper_273_00', value: 273.00, desc: 'CASNUB 22 RFT New Outer Band I/II boundary (273.00mm)' }
];

export function buildAllFixtures(targetDir) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const generatedFiles = [];

  for (const spec of FIXTURE_SPECS) {
    // Generate SVG fixture
    const svgPath = path.join(targetDir, `${spec.filename}.svg`);
    const svgContent = generateCaliperSvg(spec.value);
    fs.writeFileSync(svgPath, svgContent, 'utf-8');
    generatedFiles.push(svgPath);

    // Generate BMP image fixture
    const bmpPath = path.join(targetDir, `${spec.filename}.bmp`);
    const bmpBuffer = generateCaliperBmpBuffer(spec.value);
    fs.writeFileSync(bmpPath, bmpBuffer);
    generatedFiles.push(bmpPath);

    // Also write JSON metadata
    const jsonPath = path.join(targetDir, `${spec.filename}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({
      filename: spec.filename,
      expectedReading: spec.value,
      description: spec.desc,
      unit: 'mm',
      tolerance: 0.05
    }, null, 2), 'utf-8');
    generatedFiles.push(jsonPath);
  }

  return generatedFiles;
}

// If run directly via node
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const targetDir = path.resolve(__dirname);
  const created = buildAllFixtures(targetDir);
  console.log(`Successfully generated ${created.length} fixture files in ${targetDir}`);
}
