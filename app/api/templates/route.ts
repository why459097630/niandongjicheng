import { NextResponse } from 'next/server';
export const runtime = 'nodejs';

export async function GET() {
  // 先返回硬编码的 3 个模板，验证链路
  return NextResponse.json({
    ok: true,
    templates: ['core-template', 'simple-template', 'form-template'],
  });
}
