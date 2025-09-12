// niandongjicheng/lib/ndjc/companions.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepoPath, writeText } from './journal';
import type { NdjcOrchestratorOutput } from './types';

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function ensureFile(file: string, content: string) {
  try {
    const s = await fs.stat(file).catch(() => null);
    if (!s) {
      await ensureDir(path.dirname(file));
      await fs.writeFile(file, content, 'utf8');
      return 'created';
    }
    // 如果文件存在但大小为 0，也补上内容（避免 Gradle “Premature end of file”）
    if (s.size === 0) {
      await fs.writeFile(file, content, 'utf8');
      return 'filled';
    }
    return 'kept';
  } catch {
    await ensureDir(path.dirname(file));
    await fs.writeFile(file, content, 'utf8');
    return 'created';
  }
}

/**
 * 生成与模板配套的“伴生文件”，避免构建时缺失：
 * - app/proguard-ndjc.pro（供 Gradle proguardFiles 引用）
 * - app/src/main/res/xml/network_security_config.xml（有效 XML，避免 Gradle 解析错误）
 */
export async function emitCompanionFiles(
  o: NdjcOrchestratorOutput,
  runId: string,
) {
  const repo = getRepoPath();
  const app = path.join(repo, 'app');

  // 1) ProGuard 规则文件（即使为空，也放个注释占位，避免构建时报缺失）
  const proguardFile = path.join(app, 'proguard-ndjc.pro');
  const proguardContent =
`# NDJC companion ProGuard rules
# Add your -keep/-dontwarn rules here if needed.
`;
  const proguardStatus = await ensureFile(proguardFile, proguardContent);

  // 2) network_security_config.xml（必须是有效 XML，不能是空文件）
  const xmlDir = path.join(app, 'src', 'main', 'res', 'xml');
  const nscFile = path.join(xmlDir, 'network_security_config.xml');
  const nscContent =
`<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <!-- Allow cleartext for demo; tighten for production -->
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;
  const nscStatus = await ensureFile(nscFile, nscContent);

  // 记录到本次 run 的工件里，方便排查
  const note =
`Companion files:
- proguard: ${proguardFile}  [${proguardStatus}]
- network_security_config: ${nscFile}  [${nscStatus}]
`;
  await writeText(runId, '02_companions.txt', note);

  return { proguardFile, nscFile };
}
