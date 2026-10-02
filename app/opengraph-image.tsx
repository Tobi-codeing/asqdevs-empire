import { ImageResponse } from 'next/og';

export const alt = 'ASQDEVS EMPIRE — Digital systems for modern real-estate businesses';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0a0a0a',
          color: '#f5f3f0',
          padding: '72px',
          border: '1px solid #2a2a2a',
        }}
      >
        <div style={{ fontSize: 26, letterSpacing: 6, color: '#c6ad78' }}>ASQDEVS EMPIRE</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 68, lineHeight: 1.1, fontWeight: 300 }}>
            Digital systems built for real estate.
          </div>
          <div style={{ fontSize: 30, marginTop: 24, color: '#f5f3f0', opacity: 0.6 }}>
            websites, conversations &amp; intelligent reception.
          </div>
        </div>
        <div style={{ width: 120, height: 6, background: '#c6ad78' }} />
      </div>
    ),
    size,
  );
}
