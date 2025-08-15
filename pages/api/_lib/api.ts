// pages/api/_lib/api.ts

// 直接在这里声明 Template，避免路径依赖问题
export type Template = 'core-template' | 'simple-template' | 'form-template';

export type DispatchResp = {
  ok: boolean;
  dispatched: Template;
};

export type BuildRun = {
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | null;
};

export type BuildStatus = {
  ok: boolean;
  run: BuildRun;
};

export type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

export type ReleaseResp = {
  ok: boolean;
  tag: string;
  assets: ReleaseAsset[];
};

// 小工具
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
