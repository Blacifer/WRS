/**
 * QR code renderer
 * Indian Railways WRS Raipur
 *
 * Renders as inline SVG rather than a canvas or an image so it stays crisp
 * when printed — one of its two uses is a poster stuck on a wall in the
 * workshop, and a blurry QR is a QR nobody can scan.
 *
 * `qrcode-generator` was chosen over the more common `qrcode` package because
 * it has no dependencies at all. `qrcode` pulls in yargs, a command-line
 * argument parser, which has no business in a browser bundle and adds supply
 * chain surface to a system heading for a government security audit.
 */

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

interface Props {
  value: string;
  /** Rendered edge length in CSS pixels. */
  size?: number;
  /**
   * Error correction level. 'M' (~15% recoverable) is the sensible default;
   * 'H' (~30%) is worth it for anything printed and stuck to a wall, where the
   * code will get dirty, scuffed or partly covered.
   */
  level?: 'L' | 'M' | 'Q' | 'H';
  className?: string;
  title?: string;
}

export function QrCode({ value, size = 200, level = 'M', className, title }: Props) {
  const { path, count } = useMemo(() => {
    // Type 0 lets the library pick the smallest version that fits the data.
    const qr = qrcode(0, level);
    qr.addData(value);
    qr.make();

    const moduleCount = qr.getModuleCount();
    // One SVG path for the whole code rather than a rect per module: a typical
    // code is over a thousand modules, and that many DOM nodes is slow to
    // render and slower to print.
    let d = '';
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) d += `M${col},${row}h1v1h-1z`;
      }
    }
    return { path: d, count: moduleCount };
  }, [value, level]);

  // Four modules of quiet zone either side, as the spec requires. Without it
  // many scanners simply will not see the code.
  const quiet = 4;
  const extent = count + quiet * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      className={className}
      role="img"
      aria-label={title || 'QR code'}
      shapeRendering="crispEdges"
    >
      {title && <title>{title}</title>}
      {/* Explicit white ground: a transparent QR on a dark surface will not scan. */}
      <rect width={extent} height={extent} fill="#ffffff" />
      <g transform={`translate(${quiet},${quiet})`}>
        <path d={path} fill="#000000" />
      </g>
    </svg>
  );
}
