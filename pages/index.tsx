import React, { useState } from 'react';

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!prompt) return alert('Please enter your app idea.');
    setLoading(true);
    setResultUrl(null);
    try {
      const res = await fetch('/api/push-to-github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.success) setResultUrl(data.apkUrl || null);
      else alert('Generation failed');
    } catch {
      alert('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f172a] to-[#1e293b] text-white font-inter relative overflow-hidden">
      {/* 背景氛围 */}
      <div className="absolute inset-0 bg-grid-pattern bg-[length:24px_24px] opacity-[0.03] z-0"></div>
      <div className="absolute w-[500px] h-[500px] bg-purple-500 opacity-20 rounded-full blur-3xl top-10 -left-40"></div>
      <div className="absolute w-[400px] h-[400px] bg-blue-500 opacity-20 rounded-full blur-3xl bottom-0 -right-40"></div>

      {/* 页面内容 */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center px-6 pt-24 pb-32 animate-fadeIn">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight max-w-3xl">
          Build Your App From a Single Prompt
        </h1>
        <p className="text-lg sm:text-xl text-slate-300 mt-4 max-w-xl">
          Type your idea and get a ready-to-install APK file in minutes.
        </p>

        <div className="w-full max-w-xl mt-10">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. A meditation timer with sound alert"
            className="w-full px-6 py-4 bg-white/10 border border-white/20 text-white rounded-2xl backdrop-blur-md shadow-lg placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <p className="mt-2 text-sm text-gray-400 italic">
            Example: A to-do app with notifications and dark mode
          </p>
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="mt-8 px-8 py-3 rounded-full text-white font-semibold text-lg shadow-xl transition-all bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
        >
          {loading ? '⏳ Generating...' : '🚀 Generate App'}
        </button>

        {resultUrl && (
          <div className="mt-6 text-green-400 text-sm">
            ✅ Success!{' '}
            <a href={resultUrl} target="_blank" rel="noreferrer" className="underline">
              Download APK
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
