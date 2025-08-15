export default function HowTo() {
  return (
    <main className="prose prose-invert mx-auto max-w-3xl py-10">
      <h1>How to use</h1>
      <ol>
        <li>在首页输入「你想做的 App」，例如：<code>To-Do app with dark mode</code>。</li>
        <li>点击 <strong>Generate App</strong>，等待 1–3 分钟。</li>
        <li>构建成功后，会展示 APK 下载链接；如暂未出现，可点击页面提示跳转到 GitHub Releases 查看。</li>
      </ol>

      <h2>Templates</h2>
      <ul>
        <li><code>core-template</code>：通用模板，覆盖大多数轻应用。</li>
        <li><code>simple-template</code>：极简/计时器/清单场景。</li>
        <li><code>form-template</code>：表单/问卷/报名/反馈等。</li>
      </ul>

      <h2>Troubleshooting</h2>
      <ul>
        <li>长时间 <em>Building…</em>：刷新页面或稍后重试。</li>
        <li>Release 无 APK：构建完成到附加资产可能有延迟，稍后刷新；或直接去 Releases 查看。</li>
        <li>如遇频繁失败，请把你输入的描述、失败时间点发给我们定位。</li>
      </ul>
    </main>
  );
}
