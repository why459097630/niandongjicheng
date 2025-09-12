// app/instrumentation.ts
import { ProxyAgent, setGlobalDispatcher } from 'undici';

export async function register() {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxy) {
    setGlobalDispatcher(new ProxyAgent(proxy));
    console.log('[proxy] undici enabled =>', proxy);
  } else {
    console.log('[proxy] not set');
  }
}
