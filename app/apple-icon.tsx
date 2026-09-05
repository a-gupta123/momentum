import { ImageResponse } from 'next/og';

/**
 * The home-screen icon.
 *
 * iOS will not render SVG here, so this one asset has to be a raster. Rather
 * than commit a binary that silently drifts from the SVG mark, it is drawn from
 * the same three-bar geometry at build time.
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  const bars = [
    { left: 36, top: 101, height: 45, opacity: 0.5 },
    { left: 76, top: 70, height: 76, opacity: 0.75 },
    { left: 116, top: 34, height: 112, opacity: 1 },
  ];

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background: '#1d4ed8',
      }}
    >
      {bars.map((bar) => (
        <div
          key={bar.left}
          style={{
            position: 'absolute',
            left: bar.left,
            top: bar.top,
            width: 28,
            height: bar.height,
            borderRadius: 11,
            background: '#ffffff',
            opacity: bar.opacity,
          }}
        />
      ))}
    </div>,
    size,
  );
}
