// /pages/api/_lib/pickTemplateByText.ts
export type Template = 'core-template' | 'simple-template' | 'form-template';

export function pickTemplateByText(prompt: string): Template {
  const p = (prompt || '').toLowerCase();

  // 表单/问卷类
  if (/(form|表单|问卷|调查|报名|反馈)/.test(p)) return 'form-template';

  // 极简单页/计时器/备忘/清单等
  if (/(simple|极简|简洁|计时器|秒表|番茄|todo|清单|便签|备忘)/.test(p)) return 'simple-template';

  // 兜底：功能更全的 core
  return 'core-template';
}
