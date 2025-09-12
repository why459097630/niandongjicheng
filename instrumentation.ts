// instrumentation.ts
import { setGlobalDispatcher, ProxyAgent } from 'undici';

export async function register() {
  const p = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (p) setGlobalDispatcher(new ProxyAgent(p));
}
