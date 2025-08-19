'use client'

import { useState } from 'react'

export default function GeneratePanel() {
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setStatus('loading')
    setError(null)

    try {
      const res = await fetch('/api/push-to-github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 关键点：前端传递 x-api-secret，值来自 NEXT_PUBLIC_API_SECRET
          'x-api-secret': process.env.NEXT_PUBLIC_API_SECRET || '',
        },
        body: JSON.stringify({
          filePath: 'app/src/main/java/com/example/app/MainActivity.java',
          content: `
package com.example.app;

import android.os.Bundle;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView tv = new TextView(this);
        tv.setText("Hello from API!");
        setContentView(tv);
    }
}
          `,
          message: `feat: add main activity from prompt "${prompt}"`,
          ref: 'main',
          base64: false,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || JSON.stringify(err))
      }

      const data = await res.json()
      console.log('✅ Push success:', data)
      setStatus('success')
    } catch (e: any) {
      console.error('❌ Push failed:', e)
      setStatus('error')
      setError(e.message)
    }
  }

  return (
    <div className="p-6 bg-white/10 rounded-2xl shadow-lg max-w-xl mx-auto">
      <h2 className="text-xl font-bold text-white mb-4">Build Your App From a Single Prompt</h2>
      <input
        type="text"
        placeholder="输入一句话描述应用"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="w-full p-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
      <button
        onClick={handleGenerate}
        disabled={status === 'loading'}
        className="mt-4 w-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-semibold py-3 rounded-lg shadow hover:opacity-90 disabled:opacity-50"
      >
        {status === 'loading' ? '正在生成...' : 'Generate APK'}
      </button>

      {status === 'error' && (
        <div className="mt-4 p-3 bg-red-500 text-white rounded-lg">
          构建失败：{error}
        </div>
      )}
      {status === 'success' && (
        <div className="mt-4 p-3 bg-green-500 text-white rounded-lg">
          ✅ 提交成功，等待 GitHub Actions 打包 APK...
        </div>
      )}
    </div>
  )
}
