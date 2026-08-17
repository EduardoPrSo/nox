import { ImageResponse } from 'next/og';

export function renderNoxIcon(size: number) {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: size * 0.22,
        background: 'radial-gradient(circle at 50% 38%, #222338, #08090d 72%)',
      }}
    >
      <div
        style={{
          width: '58%',
          height: '58%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `${Math.max(1, size / 256)}px solid rgba(180,170,255,.32)`,
          borderRadius: '50%',
          boxShadow: `0 0 ${size * 0.15}px rgba(128,112,255,.24)`,
        }}
      >
        <div
          style={{
            width: '48%',
            height: '48%',
            display: 'flex',
            border: `${Math.max(1, size / 220)}px solid rgba(255,255,255,.28)`,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at 34% 27%, #f6f4ff, #aea4ff 28%, #7567e4 70%, #39316f)',
            boxShadow: `0 0 ${size * 0.11}px rgba(135,118,255,.6)`,
          }}
        />
      </div>
    </div>,
    { width: size, height: size },
  );
}
