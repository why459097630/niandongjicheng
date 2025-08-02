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
    if (!prompt) {
      alert('请先填写你的需求');
      return;
    }
    if (!selectedTemplate) {
      alert('请选择一个模板样式');
      return;
    }

    setLoading(true);
    setResultUrl(null);

    try {
      const res = await fetch('/api/push-to-github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          features,
          template: selectedTemplate,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setResultUrl(data.apkUrl || null);
      } else {
        alert('生成失败，请稍后再试');
      }
    } catch (error) {
      alert('请求出错，请检查网络或稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white shadow-xl rounded-2xl p-6">
        <h1 className="text-3xl font-bold text-center mb-6 text-blue-600">念动即成 · App 生成器</h1>

        {/* Prompt 输入 */}
        <div className="mb-5">
          <label className="font-semibold text-gray-700">🧠 请输入你的需求：</label>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：我想做一个情侣纪念日提醒 App"
            className="w-full mt-2 px-4 py-2 border rounded-lg focus:outline-none focus:ring"
          />
        </div>

        {/* 功能勾选 */}
        <div className="mb-5">
          <label className="font-semibold text-gray-700">🔘 功能选择：</label>
          <div className="flex flex-wrap gap-2 mt-2">
            {featuresList.map((feature) => (
              <button
                key={feature}
                onClick={() => handleFeatureToggle(feature)}
                className={`px-4 py-1 rounded-full border transition ${
                  features.includes(feature)
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                {feature}
              </button>
            ))}
          </div>
        </div>

        {/* 模板选择 */}
        <div className="mb-6">
          <label className="font-semibold text-gray-700">🎨 模板选择：</label>
          <div className="grid grid-cols-3 gap-3 mt-2">
            {templates.map((tpl) => (
              <div
                key={tpl.value}
                onClick={() => setSelectedTemplate(tpl.value)}
                className={`rounded-xl border-2 cursor-pointer overflow-hidden transition-all ${
                  selectedTemplate === tpl.value
                    ? 'border-blue-500 ring-2 ring-blue-300'
                    : 'border-gray-300'
                }`}
              >
                <img src={tpl.image} alt={tpl.name} className="w-full h-28 object-cover" />
                <div className="text-center py-2 font-medium">{tpl.name}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 示例 Prompt */}
        <div className="mb-6 text-sm text-gray-500">
          示例：我想做一个 <b>情侣倒计时提醒</b> App，带有 <b>提醒功能</b>，界面是 <b>清新蓝白风格</b>。
        </div>

        {/* 提交按钮 */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-xl transition"
        >
          {loading ? '⏳ 正在生成中...' : '🚀 生成我的 App'}
        </button>

        {/* 结果区域 */}
        {resultUrl && (
          <div className="mt-6 text-green-600 text-center">
            🎉 生成成功！<br />
            <a href={resultUrl} target="_blank" rel="noreferrer" className="underline">
              点击下载 APK
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
