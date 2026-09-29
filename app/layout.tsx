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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function() {
              try {
                var savedTheme = localStorage.getItem('peter_daniels_theme_v1');
                var theme = savedTheme ? savedTheme : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
                document.documentElement.setAttribute('data-theme', theme);
                if (theme === 'dark') {
                  document.documentElement.classList.add('dark');
                  document.documentElement.classList.remove('light');
                } else {
                  document.documentElement.classList.add('light');
                  document.documentElement.classList.remove('dark');
                }
              } catch (e) {}
            })();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
