// app/lib/templates.ts
import type { Template } from './types';

export const TEMPLATES: Template[] = [
  'simple-template', // 扩展模板时在此追加
];

export const DEFAULT_TEMPLATE: Template = 'simple-template';

export function normalize(text: string): string {
  return (text ?? '').toLowerCase().trim();
}

/** 根据文案简单路由到模板，找不到则回退到 DEFAULT_TEMPLATE */
export function pickTemplateByText(prompt: string): Template {
  const p = normalize(prompt);

  // 关键字示例：计时器/专注/冥想等走 simple-template
  if (/\b(timer|countdown|pomodoro|focus|meditation|breath|clock)\b/.test(p)) {
    return 'simple-template';
  }

  // 更多模板时可在此追加规则…

  return DEFAULT_TEMPLATE;
}

/** 外部传入的模板名兜底为有效模板 */
export function coerceTemplate(t?: string | null): Template {
  const v = (t ?? '').trim();
  return (v && TEMPLATES.includes(v as Template)) ? (v as Template) : DEFAULT_TEMPLATE;
}
