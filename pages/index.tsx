import React, { useState } from 'react';

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!prompt) {
      alert('Please enter your idea.');
      return;
    }

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
      else alert('Generation failed. Try again later.');
    } catch {
      alert('Network error. Try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Top Navigation */}
      <header className="w-full px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="text-lg font-bold tracking-tight">ThinkItDone</div>
        <nav className="space-x-6 text-sm text-gray-600">
          <a href="#how-it-works" className="hover:text-black transition">How it works</a>
          <a href="https://github.com/why459097630" target="_blank" className="hover:text-black transition">GitHub</a>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex flex-col items-center justify-center text-center px-6 pt-20 pb-16">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight max-w-2xl leading-tight">
          Generate your App from a single sentence.
        </h1>
        <p className="text-lg sm:text-xl text-gray-600 mt-4 max-w-xl">
          Just type what you want — our AI turns it into an installable APK for you.
        </p>

        {/* Prompt Input */}
        <div className="w-full max-w-xl mt-10">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. I want a meditation timer with sound alert"
            className="w-full px-6 py-4 border border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 text-base"
          />
          <p className="mt-2 text-sm text-gray-400 italic">
            Example: A to-do list app with dark theme and reminders
          </p>
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="mt-8 px-8 py-3 rounded-xl text-white font-semibold text-lg shadow-md transition-all bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600"
        >
          {loading ? '⏳ Generating...' : '🚀 Generate App'}
        </button>

        {/* Result */}
        {resultUrl && (
          <div className="mt-6 text-green-600 text-sm">
            ✅ Your App is ready!{' '}
            <a href={resultUrl} target="_blank" rel="noreferrer" className="underline">
              Download APK
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
