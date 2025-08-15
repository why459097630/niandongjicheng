// app/lib/templates.ts
import type { Template } from './client';

export function pickTemplateByText(prompt: string): Template {
  const p = (prompt || '').toLowerCase();

  // 表单/问卷类
  if (/(form|表单|问卷|调查|报名|反馈)/.test(p)) return 'form-template';
  // 极简页/计时器/备忘
  if (/(simple|极简|计时器|倒计时|秒表|番茄|todo|清单|便签|备忘)/.test(p)) return 'simple-template';

  return 'core-template';
}
