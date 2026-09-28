import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Peter Daniels — Virtual Mentor',
  description: 'Wisdom and inspiration from the teachings of Peter Daniels',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
