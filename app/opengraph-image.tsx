import { ImageResponse } from 'next/og';

/**
 * The link preview card.
 *
 * Generated rather than committed so the headline stays in sync with the
 * product copy, and so there is no 200KB PNG in git history. Everything is
 * inline styles with system-ish fonts: `next/og` renders with Satori, which
 * supports a deliberately small subset of CSS — no external stylesheets, no CSS
 * variables, and no `gap` on some versions, so spacing is explicit.
 */
export const alt = 'Momentum — turn a brain dump into a realistic day';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  const bars = [
    { height: 44, opacity: 0.45 },
    { height: 74, opacity: 0.72 },
    { height: 108, opacity: 1 },
  ];

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#12141c',
        padding: '72px 80px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        {bars.map((bar, index) => (
          <div
            key={bar.height}
            style={{
              width: 26,
              height: bar.height,
              borderRadius: 9,
              background: '#7aa2ff',
              opacity: bar.opacity,
              marginRight: index === bars.length - 1 ? 20 : 10,
            }}
          />
        ))}
        <div
          style={{
            fontSize: 34,
            fontWeight: 600,
            color: '#f4f5f9',
            letterSpacing: '-0.02em',
            paddingBottom: 4,
          }}
        >
          Momentum
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 76,
            fontWeight: 600,
            color: '#f4f5f9',
            // Gentler than the in-app display tracking. Satori renders with
            // a fallback font whose metrics do not absorb tight negative
            // tracking; past about -0.02em the word gaps go visibly uneven.
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            maxWidth: 900,
          }}
        >
          Turn a brain dump into a realistic day.
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 30,
            color: '#a2a8bd',
            lineHeight: 1.4,
            maxWidth: 860,
          }}
        >
          Capture in plain language, rank work against long-term goals, and build a time-blocked day
          that fits the hours you actually have.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        {['Natural-language capture', 'Explainable priorities', 'Capacity-aware plan'].map(
          (label) => (
            <div
              key={label}
              style={{
                display: 'flex',
                fontSize: 22,
                color: '#c9cddb',
                border: '1px solid #2a2f3d',
                borderRadius: 999,
                padding: '10px 22px',
                marginRight: 14,
              }}
            >
              {label}
            </div>
          ),
        )}
      </div>
    </div>,
    size,
  );
}
