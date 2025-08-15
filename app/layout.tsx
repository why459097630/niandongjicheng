// app/layout.tsx
import './globals.css';

export const metadata = {
  title: 'Niandongjicheng',
  description: 'Build your app from a single prompt',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* 这里可以放全局 class，例如暗色背景 */}
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
