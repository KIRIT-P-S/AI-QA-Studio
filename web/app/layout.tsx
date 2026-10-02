import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI QA Studio',
  description: 'AI-native product validation tool connecting PRDs to releases',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
