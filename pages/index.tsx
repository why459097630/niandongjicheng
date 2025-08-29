import { useState } from "react";

/**
 * 内置轻量 UI 组件，避免外部依赖导致 Vercel 构建失败。
 */
function cn(...cls: (string | false | null | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}

function Card({ className = "", children }: any) {
  return (
    <div className={cn("rounded-2xl border border-white/20 bg-white/5", className)}>
      {children}
    </div>
  );
}
function CardContent({ className = "", children }: any) {
  return <div className={cn("p-6", className)}>{children}</div>;
}
function Button({ className = "", children, disabled, onClick }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-10 py-4 rounded-2xl text-lg font-semibold bg-gradient-to-r from-pink-500 to-indigo-500 shadow-lg transition disabled:opacity-60",
        !disabled && "hover:scale-105",
        className
      )}
    >
      {children}
    </button>
  );
}
function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full p-4 rounded-2xl bg-white/10 border border-white/20 text-white placeholder-gray-400 outline-none",
        className
      )}
    />
  );
}
function Checkbox({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onCheckedChange}
      className="h-5 w-5 rounded-md border-white/30 bg-white/10"
    />
  );
}

export default function HomePage() {
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [template, setTemplate] = useState<"simple" | "core" | "form">("core");
  const [result, setResult] = useState<{
    previewUrl?: string;
    apkUrl?: string;
    zipUrl?: string;
    message?: string;
  } | null>(null);

  const featureOptions = [
    { key: "auth", label: "登录 / 注册" },
    { key: "storage", label: "数据存储（本地/云端）" },
    { key: "form", label: "表单提交" },
    { key: "push", label: "推送通知" },
    { key: "theme", label: "主题切换（深色/浅色）" },
    { key: "i18n", label: "多语言支持" },
    { key: "camera", label: "相机权限" },
    { key: "location", label: "定位权限" },
    { key: "share", label: "分享功能" },
    { key: "analytics", label: "基础统计分析" },
  ];

  const handleToggle = (key: string) => {
    setFeatures((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleGenerate = async () => {
    if (!prompt.trim() && features.length === 0) {
      alert("请至少填写一句需求或勾选一个功能");
      return;
    }
    setLoading(true);
    setResult(null);

    const payload = {
      prompt,
      template,
      features,
      meta: {
        appName: "My App",
      },
    };

    try {
      const res = await fetch("/api/generate-apk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setResult({ message: e?.message || "生成失败，请稍后再试" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-900 via-purple-900 to-black text-white font-inter flex flex-col items-center p-6">
      {/* 标题区 */}
      <div className="text-center mt-12">
        <h1 className="text-4xl md:text-6xl font-bold">一句话生成你的专属 App</h1>
        <p className="text-lg text-gray-300 mt-4 max-w-xl mx-auto">
          输入需求，选择功能，即刻下载原生 APK
        </p>
      </div>

      {/* 输入区 */}
      <div className="mt-10 w-full max-w-2xl space-y-6">
        <Input
          value={prompt}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setPrompt(e.target.value)
          }
          placeholder="例如：记账本 / 健身打卡 / 咖啡店预约"
        />

        {/* 功能勾选 */}
        <Card className="bg-white/5 border-white/20 text-white rounded-2xl">
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 p-6">
            {featureOptions.map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center space-x-2 cursor-pointer"
              >
                <Checkbox
                  checked={features.includes(key)}
                  onCheckedChange={() => handleToggle(key)}
                />
                <span>{label}</span>
              </label>
            ))}
          </CardContent>
        </Card>

        {/* 模板选择 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { key: "simple", title: "Simple 模板", desc: "单页展示类应用" },
            { key: "core", title: "Core 模板", desc: "多页面+导航" },
            { key: "form", title: "Form 模板", desc: "含表单/登录/数据交互" },
          ].map((tpl) => (
            <Card
              key={tpl.key}
              onClick={() => setTemplate(tpl.key as any)}
              className={`bg-white/5 border-white/20 rounded-2xl hover:bg-white/10 cursor-pointer ${
                template === tpl.key ? "ring-2 ring-pink-400" : ""
              }`}
            >
              <CardContent className="p-6">
                <h3 className="text-xl font-semibold mb-2">{tpl.title}</h3>
                <p className="text-gray-300 text-sm">{tpl.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 生成按钮 */}
        <div className="flex justify-center mt-6">
          <Button onClick={handleGenerate} disabled={loading}>
            {loading ? "生成中..." : "立即生成 App"}
          </Button>
        </div>
      </div>

      {/* 结果展示区 */}
      <div className="mt-16 w-full max-w-3xl text-center">
        <h2 className="text-2xl font-bold mb-6">生成结果</h2>
        {!result && (
          <p className="text-gray-400">
            点击“立即生成 App”后将在此显示预览和下载链接
          </p>
        )}
        {result && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-white/5 border-white/20 rounded-2xl">
              <CardContent className="flex flex-col items-center p-6">
                <div className="w-10 h-10 mb-3 rounded-full border border-white/30 flex items-center justify-center">
                  🖥️
                </div>
                {result?.previewUrl ? (
                  <a
                    href={result.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    在线预览
                  </a>
                ) : (
                  <p>在线预览</p>
                )}
              </CardContent>
            </Card>
            <Card className="bg-white/5 border-white/20 rounded-2xl">
              <CardContent className="flex flex-col items-center p-6">
                <div className="w-10 h-10 mb-3 rounded-full border border-white/30 flex items-center justify-center">
                  ⬇️
                </div>
                {result?.apkUrl ? (
                  <a
                    href={result.apkUrl}
                    className="underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    APK 下载
                  </a>
                ) : (
                  <p>APK 下载</p>
                )}
              </CardContent>
            </Card>
            <Card className="bg-white/5 border-white/20 rounded-2xl">
              <CardContent className="flex flex-col items-center p-6">
                <div className="w-10 h-10 mb-3 rounded-full border border-white/30 flex items-center justify-center">
                  💾
                </div>
                {result?.zipUrl ? (
                  <a
                    href={result.zipUrl}
                    className="underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    源码 ZIP
                  </a>
                ) : (
                  <p>源码 ZIP</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
        {result?.message && (
          <p className="mt-4 text-red-300">{result.message}</p>
        )}
      </div>
    </div>
  );
}
