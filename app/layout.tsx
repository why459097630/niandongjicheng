import "../styles/tailwind.css";

export const metadata = {
  title: "NDJC",
  description: "Native APK Generator",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
