import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomicSync } from '@morehao/dsh-plugin-kit/fs';

export interface ProjectOverride {
  mode: 'auto' | 'manual' | 'hidden';
  reason?: string;
  at: string;
}

export interface ProjectConfig {
  version: 1;
  project?: string;
  updatedAt: string;
  overrides: Record<string, ProjectOverride>;
}

export const PROJECT_CONFIG_FILE = 'skills-console.json';

export function projectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.dsh', PROJECT_CONFIG_FILE);
}

/**
 * 读取 `<projectRoot>/.dsh/skills-console.json`。
 * 文件缺失、JSON 损坏或版本不匹配时返回 null（fail-open）。
 */
export function readProjectConfig(projectRoot: string): ProjectConfig | null {
  if (!projectRoot || typeof projectRoot !== 'string') return null;
  const filePath = projectConfigPath(projectRoot);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.version !== 1) return null;
    if (parsed.overrides !== undefined && (typeof parsed.overrides !== 'object' || parsed.overrides === null || Array.isArray(parsed.overrides))) {
      return null;
    }
    return {
      version: 1,
      project: typeof parsed.project === 'string' ? parsed.project : path.basename(projectRoot),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      overrides: (parsed.overrides && typeof parsed.overrides === 'object' && !Array.isArray(parsed.overrides))
        ? parsed.overrides
        : {},
    };
  } catch {
    return null;
  }
}

/**
 * 批量写入项目级调用策略覆写。
 * - 确保 `<projectRoot>/.dsh` 存在；
 * - 原子重命名写回；
 * - mode === 'default' 时从 overrides map 中删除覆写条目。
 */
export function batchWriteProjectOverrides(
  projectRoot: string,
  names: string[],
  mode: 'auto' | 'manual' | 'hidden' | 'default',
): ProjectConfig {
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('projectRoot 必须是非空字符串');
  }
  if (!['auto', 'manual', 'hidden', 'default'].includes(mode)) {
    throw new Error(`mode 只能是 auto / manual / hidden / default，收到 ${mode}`);
  }
  const existing = readProjectConfig(projectRoot);
  const overrides: Record<string, ProjectOverride> = existing?.overrides ? { ...existing.overrides } : {};
  const project = existing?.project || path.basename(projectRoot);
  const now = new Date().toISOString();

  for (const name of names) {
    if (!name || typeof name !== 'string') continue;
    if (mode === 'default') {
      delete overrides[name];
    } else {
      overrides[name] = { mode, at: now };
    }
  }

  const nextConfig: ProjectConfig = {
    version: 1,
    project,
    updatedAt: now,
    overrides,
  };

  const dshDir = path.join(projectRoot, '.dsh');
  fs.mkdirSync(dshDir, { recursive: true });
  const filePath = projectConfigPath(projectRoot);
  writeFileAtomicSync(filePath, `${JSON.stringify(nextConfig, null, 2)}\n`);
  return nextConfig;
}

/**
 * 写入单个技能的项目级调用策略覆写。
 */
export function writeProjectOverride(
  projectRoot: string,
  name: string,
  mode: 'auto' | 'manual' | 'hidden' | 'default',
): ProjectConfig {
  return batchWriteProjectOverrides(projectRoot, [name], mode);
}
