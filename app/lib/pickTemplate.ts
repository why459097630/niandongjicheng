export type Template = 'core-template' | 'simple-template' | 'form-template';

export function pickTemplateByText(prompt: string): Template {
  const p = (prompt || '').toLowerCase();

  // 表单/问卷类
  if (/(form|表单|问卷|问答|报名|反馈)/.test(p)) return 'form-template';

  // 轻量工具/极简/清单/番茄钟/备忘/计时器等
  if (/(simple|极简|计时器|清单|备忘|todo|番茄|便签|笔记)/.test(p)) return 'simple-template';

  // 默认
  return 'core-template';
}
