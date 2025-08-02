import React, { useState } from 'react';

const featuresList = ['倒计时', '拍照', '提醒音', '分享'];
const templates = [
  { name: '极简黑白', value: 'minimal', image: '/template-minimal.png' },
  { name: '清新蓝白', value: 'bluewhite', image: '/template-bluewhite.png' },
  { name: '暗夜炫酷', value: 'darkcool', image: '/template-darkcool.png' },
];

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [features, setFeatures] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const handleFeatureToggle = (feature: string) => {
    setFeatures(prev =>
      prev.includes(feature) ? prev.filter(f => f !== feature) : [...prev, feature]
    );
  };

  const handleSubmit = async () => {
    if (!prompt || !selectedTemplate) {
      alert('请填写需求并选择模板');
      return;
    }

    setLoading(true);
    setResultUrl(null);

    try {
      const res = await fetch('/api/push-to-github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, features, template: selectedTemplate }),
      });
      const data = await res.json();
      if (data.success) setResultUrl(data.apkUrl || null);
      else alert('生成失败，请稍后再试');
    } catch {
      alert('请求出错，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-white to-sky-50 px-4 py-12">
      {/* 标题区 */}
      <div className="text-center max-w-xl mx-auto mb-10">
        <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900">
          念动即成 · App 生成器
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          一句话生成你专属的 App，自动打包、自动下载，0 编程门槛。
        </p>
      </div>

      {/* Prompt 输入 */}
      <div className="max-w-2xl mx-auto bg-white shadow-md rounded-2xl p-6 space-y-6">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">🧠 输入你的想法：</label>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：我想做一个情侣纪念日提醒 App"
            className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        {/* 功能勾选 */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">🔘 选择功能：</label>
          <div className="flex flex-wrap gap-3">
            {featuresList.map((feature) => (
              <button
                key={feature}
                onClick={() => handleFeatureToggle(feature)}
                className={`px-4 py-1 rounded-full text-sm border transition ${
                  features.includes(feature)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                {feature}
              </button>
            ))}
          </div>
        </div>

        {/* 模板选择 */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">🎨 模板风格：</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {templates.map((tpl) => (
              <div
                key={tpl.value}
                onClick={() => setSelectedTemplate(tpl.value)}
                className={`cursor-pointer rounded-xl border-2 overflow-hidden shadow-sm transition-all ${
                  selectedTemplate === tpl.value
                    ? 'border-blue-500 ring-2 ring-blue-200'
                    : 'border-gray-300'
                }`}
              >
                <img src={tpl.image} alt={tpl.name} className="w-full h-28 object-cover" />
                <div className="text-center py-2 font-medium text-sm">{tpl.name}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 示例 prompt */}
        <p className="text-sm text-gray-500">
          示例：我想做一个 <b>情侣倒计时提醒</b> App，带有 <b>提醒功能</b>，界面为 <b>清新蓝白风格</b>。
        </p>

        {/* 提交按钮 */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full py-3 rounded-xl text-white text-lg font-semibold transition bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 shadow-lg"
        >
          {loading ? '⏳ 正在生成中...' : '🚀 生成我的 App'}
        </button>

        {/* 结果 */}
        {resultUrl && (
          <div className="text-green-600 mt-4 text-center text-sm">
            🎉 成功生成！<br />
            <a href={resultUrl} className="underline" target="_blank" rel="noreferrer">
              点击下载 APK
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
