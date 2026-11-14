import fs from 'node:fs';
import { findProjectRoot } from '../paths.js';
import { batchWriteProjectOverrides, writeProjectOverride } from '../project-policy.js';
import { ServiceError } from './errors.js';
import { assertSafeSkillName } from './shared.js';
import type { ServiceCtx } from '../../contract/service.js';

/**
 * 设置单个技能的项目级调用策略覆写。
 */
export async function setProjectInvocation(
  ctx: ServiceCtx,
  { cwd, name, mode }: { cwd?: string; name: string; mode: 'auto' | 'manual' | 'hidden' | 'default' } = {} as any,
) {
  if (!cwd || typeof cwd !== 'string' || !cwd.trim()) {
    throw new ServiceError('error.skills.bad-request', 'cwd 必填且必须是有效目录路径');
  }
  const projectRoot = findProjectRoot(cwd, fs.existsSync);
  if (!projectRoot) {
    throw new ServiceError('error.skills.not-in-project', `${cwd} 不是有效的项目目录（找不到 .git）`);
  }
  assertSafeSkillName(name);
  if (!['auto', 'manual', 'hidden', 'default'].includes(mode)) {
    throw new ServiceError('error.skills.bad-mode', 'mode 只能是 auto / manual / hidden / default');
  }

  return ctx.runtime.enqueue(`project-policy:${projectRoot}`, async () => {
    writeProjectOverride(projectRoot, name, mode);
    try {
      await ctx.invalidatePolicies();
    } catch (error: any) {
      ctx.logger('policy.invalidate.failed', { message: error?.message });
    }
    ctx.logger('project.invocation.set', { projectRoot, name, mode });
    return { ok: true, projectRoot, name, mode };
  });
}

/**
 * 批量设置技能的项目级调用策略覆写。
 */
export async function batchSetProjectInvocation(
  ctx: ServiceCtx,
  { cwd, names, mode }: { cwd?: string; names: string[]; mode: 'auto' | 'manual' | 'hidden' | 'default' } = {} as any,
) {
  if (!cwd || typeof cwd !== 'string' || !cwd.trim()) {
    throw new ServiceError('error.skills.bad-request', 'cwd 必填且必须是有效目录路径');
  }
  const projectRoot = findProjectRoot(cwd, fs.existsSync);
  if (!projectRoot) {
    throw new ServiceError('error.skills.not-in-project', `${cwd} 不是有效的项目目录（找不到 .git）`);
  }
  if (!Array.isArray(names)) {
    throw new ServiceError('error.skills.bad-request', 'names 必须是数组');
  }
  for (const name of names) {
    assertSafeSkillName(name);
  }
  if (!['auto', 'manual', 'hidden', 'default'].includes(mode)) {
    throw new ServiceError('error.skills.bad-mode', 'mode 只能是 auto / manual / hidden / default');
  }

  return ctx.runtime.enqueue(`project-policy:${projectRoot}`, async () => {
    batchWriteProjectOverrides(projectRoot, names, mode);
    try {
      await ctx.invalidatePolicies();
    } catch (error: any) {
      ctx.logger('policy.invalidate.failed', { message: error?.message });
    }
    ctx.logger('project.invocation.batch', { projectRoot, names, mode });
    return { ok: true, projectRoot, names, mode };
  });
}
