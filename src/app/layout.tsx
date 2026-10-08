import type { Metadata } from 'next';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-serif/400.css';
import '@fontsource/ibm-plex-serif/600.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'ClawBack | Get your share of the US tariff refund',
  description: 'Indian exporters discounted their prices to absorb US IEEPA tariffs. The refunds are going to US buyers. ClawBack proves your share and helps you get it back.',
  openGraph: { title: 'ClawBack', description: 'Your US buyer got the tariff refund. Part of it is yours.', type: 'website' },
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
