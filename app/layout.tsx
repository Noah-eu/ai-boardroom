import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/context/AppContext';

export const metadata: Metadata = {
  title: 'AI Boardroom',
  description: 'Multi-agent AI orchestration dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans bg-gray-950 text-gray-100 antialiased">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
