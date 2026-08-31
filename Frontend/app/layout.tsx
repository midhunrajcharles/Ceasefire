import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ceasefire — Brand Impersonation Reconnaissance',
  description:
    'Sweeps ten search surfaces for anyone impersonating a brand, ranks findings by harm, and drafts the takedown notice for human review.',
  icons: {
    icon: '/favicon.ico',
  }
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="bg-white text-neutral-900 antialiased selection:bg-black selection:text-white">
      <body className="overflow-x-hidden min-h-screen bg-white">
        {children}
      </body>
    </html>
  );
}
