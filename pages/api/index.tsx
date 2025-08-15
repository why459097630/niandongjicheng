// pages/index.tsx
import Head from 'next/head';
import { useState } from 'react';

export default function Home() {
  const [prompt, setPrompt] = useState('');

  return (
    <>
      <Head>
        <title>Build Your App From a Single Prompt</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* 可选：Google Fonts 的 Inter（也可以用 next/font） */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap"
          rel="stylesheet"
        />
      </Head>

      <main className="min-h-screen relative overflow-hidden">
        {/* 背景装饰网格 */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08] bg-grid-pattern bg-[size:22px_22px]"
          aria-hidden
        />

        <div className="relative z-10 max-w-3xl mx-auto px-6 pt-28 pb-24 text-center animate-fadeIn">
          <h1 className="font-inter text-4xl sm:text-5xl md:text-6xl font-extrabold leading-tight">
            Build Your App From a{' '}
            <span className="bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-emerald-300 bg-clip-text text-transparent">
              Single Prompt
            </span>
          </h1>

          <p className="mt-6 text-slate-300/90 text-base sm:text-lg">
            Type your idea and get a ready-to-install APK file in minutes.
          </p>

          <div className="mt-10 flex items-center gap-3 mx-auto max-w-xl">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A meditation timer with sound alert"
              className="flex-1 rounded-xl bg-slate-800/80 border border-slate-700/60 px-4 py-3
                         outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500/60
                         placeholder:text-slate-400"
            />
            <button
              onClick={() => alert(`TODO: 调用后端生成 APK\n\nPrompt: ${prompt || '（空）'}`)}
              className="rounded-xl px-5 py-3 bg-gradient-to-r from-fuchsia-500 to-indigo-500
                         hover:from-fuchsia-400 hover:to-indigo-400 transition-colors font-semibold"
            >
              Generate App
            </button>
          </div>

          <p className="mt-4 text-slate-400 text-sm">
            Example: A to-do app with notifications and dark mode
          </p>
        </div>
      </main>
    </>
  );
}
