import type { Metadata, Viewport } from 'next';
import { SITE_URL } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'ASQDEVS EMPIRE — Digital Systems for Real Estate',
    template: '%s — ASQDEVS EMPIRE',
  },
  description:
    'Premium real-estate websites, WhatsApp automation and AI phone reception systems built by ASQDEVS EMPIRE.',
  applicationName: 'ASQDEVS EMPIRE',
  keywords: [
    'real estate website design',
    'WhatsApp automation',
    'AI phone receptionist',
    'property website',
    'real estate lead qualification',
  ],
  authors: [{ name: 'ASQDEVS EMPIRE' }],
  openGraph: {
    type: 'website',
    siteName: 'ASQDEVS EMPIRE',
    title: 'ASQDEVS EMPIRE — Digital Systems for Real Estate',
    description:
      'Premium real-estate websites, WhatsApp automation and AI phone reception systems built by ASQDEVS EMPIRE.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ASQDEVS EMPIRE — Digital Systems for Real Estate',
    description:
      'Premium real-estate websites, WhatsApp automation and AI phone reception systems built by ASQDEVS EMPIRE.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `globals.css` sets `scroll-behavior: smooth` for the in-page anchors
    // (/#work, /#contact). This attribute restores the pre-Next-16 behaviour of
    // overriding it during route transitions, so opening a project page jumps
    // to the top instead of smooth-scrolling the whole way up.
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
