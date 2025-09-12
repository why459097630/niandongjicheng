// 让 Next（Node/undici）在进程级别走代理
// Node 运行时：app/api/** 内的 route.ts 首次 import 时执行一次即可
try {
  // 仅在 Node/服务器端有效；Edge runtime 不支持
  // 如果你的依赖树没有显式安装 undici，也能用（Next 内置）
  const undici = require('undici') as typeof import('undici');

  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.https_proxy;

  if (proxyUrl) {
    const agent = new undici.ProxyAgent(proxyUrl);
    undici.setGlobalDispatcher(agent);
    // 可选：LOG 一下方便确认
    // console.log('[proxy] using', proxyUrl);
  }
} catch {
  // 忽略：在某些环境下没有 undici 或被 tree-shake，也不影响非代理场景
}
