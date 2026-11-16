import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPaths } from '../dist/core/paths.js';
import {
  createPolicyProvider,
  installPolicyProviders,
  POLICY_PROVIDER,
  POLICY_RANK,
} from '../dist/core/policy.js';
import {
  readProjectConfig,
  writeProjectOverride,
  batchWriteProjectOverrides,
} from '../dist/core/project-policy.js';
import { findProjectRoot } from '../dist/core/roots.js';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshsc-policy-'));
  const home = path.join(root, 'home');
  const paths = createPaths({ HOME: home, DSH_HOME: path.join(home, '.dsh') });
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  return { root, home, paths, project };
}

function writeSkill(dir, name, description = 'demo') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\nbody of ${description}\n`,
    'utf8',
  );
  return dir;
}

function stateWith(enabled, name = 'demo') {
  return { installs: [{ name, enabled }] };
}

function providerFor(paths, state) {
  return createPolicyProvider({ paths, getState: () => state });
}

test('list：只报告 enabled=false 的 canonical；启用/缺失/平铺都不报告', async () => {
  const { root, paths } = sandbox();
  writeSkill(path.join(paths.canonical, 'demo'), 'demo');
  writeSkill(path.join(paths.canonical, 'flat'), 'flat');

  const off = providerFor(paths, stateWith(false));
  const candidates = await off.list({});
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, 'demo');
  assert.equal(candidates[0].provider, POLICY_PROVIDER);
  assert.equal(candidates[0].rank, POLICY_RANK);
  assert.equal(candidates[0].invocation.modelInvocable, false);
  assert.equal(candidates[0].invocation.userInvocable, false);
  assert.equal(candidates[0].source, 'user-agents');
  assert.equal(candidates[0].path, path.join(paths.canonical, 'demo', 'SKILL.md'));
  assert.deepEqual(candidates[0].locator.installName, 'demo');

  assert.deepEqual(await providerFor(paths, stateWith(true)).list({}), [], 'enabled 技能交给宿主文件系统 provider');

  // flat `<name>.md`：本期不支持启停，provider 必须沉默
  fs.rmSync(path.join(paths.canonical, 'flat'), { recursive: true, force: true });
  fs.writeFileSync(path.join(paths.canonical, 'flat.md'), '---\nname: flat\ndescription: f\n---\n');
  assert.deepEqual(await providerFor(paths, { installs: [{ name: 'flat', enabled: false }] }).list({}), []);

  // canonical 目录被删：不能凭空发一个候选
  fs.rmSync(path.join(paths.canonical, 'demo'), { recursive: true, force: true });
  assert.deepEqual(await off.list({}), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('list：项目 / user-dsh 有同名副本时沉默（条件发候选，P0b）', async () => {
  const { root, home, paths, project } = sandbox();
  writeSkill(path.join(paths.canonical, 'demo'), 'demo');
  const provider = providerFor(paths, stateWith(false));

  writeSkill(path.join(project, '.dsh', 'skills', 'demo'), 'demo', 'project copy');
  assert.deepEqual(await provider.list({ cwd: project }), [], '项目副本优先：不许把项目副本一起压掉');

  fs.rmSync(path.join(project, '.dsh'), { recursive: true, force: true });
  writeSkill(path.join(home, '.dsh', 'skills', 'demo'), 'demo', 'user-dsh copy');
  assert.deepEqual(await provider.list({ cwd: project }), [], 'user-dsh 副本优先');
  assert.deepEqual(await provider.list({}), [], '没有 cwd 时 user-dsh 也是全局根');

  fs.rmSync(path.join(home, '.dsh', 'skills', 'demo'), { recursive: true, force: true });
  const candidates = await provider.list({ cwd: project });
  assert.equal(candidates.length, 1, 'canonical 是 native winner 才发候选');
  fs.rmSync(root, { recursive: true, force: true });
});

test('get：回读正文并重新校验（state / 路径 / winner），陈旧候选一律 undefined', async () => {
  const { root, paths, project } = sandbox();
  writeSkill(path.join(paths.canonical, 'demo'), 'demo', 'canonical body');
  const state = stateWith(false);
  const provider = providerFor(paths, state);
  const [candidate] = await provider.list({});

  const doc = await provider.get(candidate, {});
  assert.equal(doc.name, 'demo');
  assert.equal(doc.invocation.modelInvocable, false);
  assert.equal(doc.content.includes('body of canonical body'), true, '正文要来自 canonical SKILL.md');
  assert.equal(doc.path, candidate.path);

  assert.equal(await provider.get({ ...candidate, locator: { ...candidate.locator, docPath: '/etc/passwd' } }, {}), undefined, '不信任候选里的路径');
  assert.equal(await provider.get({ ...candidate, locator: { ...candidate.locator, installName: '../demo' } }, {}), undefined);

  state.installs[0].enabled = true;
  assert.equal(await provider.get(candidate, {}), undefined, 'state 已启用就不再服务');
  state.installs[0].enabled = false;

  writeSkill(path.join(project, '.dsh', 'skills', 'demo'), 'demo', 'project copy');
  assert.equal(await provider.get(candidate, { cwd: project }), undefined, '副本赢了就沉默');
  fs.rmSync(root, { recursive: true, force: true });
});

test('list：canonical 不在 DSH 扫描根里（DSH_AGENTS_HOME 被改）时沉默', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshsc-policy-unscanned-'));
  const home = path.join(root, 'home');
  const paths = createPaths({
    HOME: home,
    DSH_HOME: path.join(home, '.dsh'),
    DSH_AGENTS_HOME: path.join(root, 'elsewhere', '.agents'),
  });
  writeSkill(path.join(paths.canonical, 'demo'), 'demo');
  assert.equal(paths.canonicalScanned, false);
  assert.deepEqual(await providerFor(paths, stateWith(false)).list({}), []);
  fs.rmSync(root, { recursive: true, force: true });
});

/** 假 ctx：全局 skills registry + agents service + 事件总线，足够覆盖注册生命周期。 */
function fakeContext({ globalSkills = true, registerBroken = false } = {}) {
  const handlers = new Map();
  const registered = [];
  const state = { agents: [], disposedScopes: 0, invalidated: 0 };
  const skills = globalSkills
    ? {
        registerProvider(factory) {
          const control = {
            invalidate() {
              state.invalidated += 1;
            },
          };
          registered.push(factory(control));
          return () => {
            state.disposedScopes += 1;
          };
        },
      }
    : null;
  const ctx = {
    get(key) {
      if (key === 'skills') return skills;
      if (key === 'agents') return { list: () => state.agents };
      return null;
    },
    on(event, handler) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  };
  return {
    ctx,
    state,
    registered,
    emit(event, payload) {
      handlers.get(event)?.(payload);
    },
    agent(id) {
      const scoped = registerBroken ? {} : skills;
      return { id, ctx: { get: (key) => (key === 'skills' ? scoped : null) } };
    },
  };
}

test('registry：初始 agent + created/disposed + invalidate + dispose', () => {
  const provider = { name: 'p', list: async () => [], get: async () => undefined };
  const first = fakeContext();
  const a1 = first.agent('a1');
  first.state.agents.push(a1);
  const policies = installPolicyProviders(first.ctx, { provider });

  assert.deepEqual(policies.status(), {
    available: true,
    liveAgents: 1,
    registered: 1,
    errors: [],
  });
  assert.equal(first.registered[0].name, 'p', '注册的是同一个 provider 的形状');

  policies.invalidate();
  assert.equal(first.state.invalidated, 1);

  const a2 = first.agent('a2');
  first.emit('agent/created', { agent: a2 });
  assert.equal(policies.status().registered, 2);

  first.emit('agent/disposed', { agent: a1 });
  assert.equal(policies.status().registered, 1, 'disposed 后要撤掉该 scope 的注册');
  assert.equal(first.state.disposedScopes, 1);

  policies.dispose();
  policies.dispose();
  assert.equal(first.state.disposedScopes, 2, 'dispose 幂等');
  assert.equal(policies.status().registered, 0);
});

test('registry：宿主没有 registerProvider → available=false；agent 注册失败 → errors 可见', () => {
  const provider = { name: 'p', list: async () => [], get: async () => undefined };
  const missing = fakeContext({ globalSkills: false });
  const missingPolicies = installPolicyProviders(missing.ctx, { provider });
  assert.equal(missingPolicies.status().available, false);

  const broken = fakeContext({ registerBroken: true });
  broken.state.agents.push(broken.agent('a1'));
  const brokenPolicies = installPolicyProviders(broken.ctx, { provider });
  assert.equal(brokenPolicies.status().registered, 0);
  assert.deepEqual(brokenPolicies.status().errors.map((item) => item.code), ['no-register-provider']);
});

test('project-policy：readProjectConfig 与 writeProjectOverride 读写往返、default 删除覆写', () => {
  const { root, project } = sandbox();

  // 1. 缺失时返回 null
  assert.equal(readProjectConfig(project), null);

  // 2. 写入单个 override
  const cfg1 = writeProjectOverride(project, 'demo', 'hidden');
  assert.equal(cfg1.version, 1);
  assert.equal(cfg1.overrides.demo.mode, 'hidden');
  assert.ok(cfg1.overrides.demo.at);

  // 3. 回读
  const read1 = readProjectConfig(project);
  assert.equal(read1.version, 1);
  assert.equal(read1.overrides.demo.mode, 'hidden');

  // 4. 批量写入
  const cfg2 = batchWriteProjectOverrides(project, ['skill-a', 'skill-b'], 'auto');
  assert.equal(cfg2.overrides['skill-a'].mode, 'auto');
  assert.equal(cfg2.overrides['skill-b'].mode, 'auto');
  assert.equal(cfg2.overrides.demo.mode, 'hidden', '保留既有覆写');

  // 5. 'default' 删除覆写
  const cfg3 = writeProjectOverride(project, 'demo', 'default');
  assert.equal(cfg3.overrides.demo, undefined);
  assert.equal(readProjectConfig(project).overrides.demo, undefined);

  // 6. 损坏的 JSON 返回 null
  fs.writeFileSync(path.join(project, '.dsh', 'skills-console.json'), 'not-json');
  assert.equal(readProjectConfig(project), null);

  fs.rmSync(root, { recursive: true, force: true });
});

test('policyProvider：项目级覆写生效（hidden 强制隐藏，auto 项目级解禁全局停用）', async () => {
  const { root, paths, project } = sandbox();
  writeSkill(path.join(paths.canonical, 'alpha'), 'alpha', 'alpha desc');
  writeSkill(path.join(paths.canonical, 'beta'), 'beta', 'beta desc');

  // 全局状态：alpha 是 enabled=false (全局停用)，beta 是 enabled=true (全局启用)
  const state = {
    installs: [
      { name: 'alpha', enabled: false },
      { name: 'beta', enabled: true },
    ],
  };
  const provider = providerFor(paths, state);

  // 无项目覆写时：alpha 报告停用候选，beta 不报告
  const initial = await provider.list({ cwd: project });
  assert.equal(initial.length, 1);
  assert.equal(initial[0].name, 'alpha');
  assert.equal(initial[0].source, 'user-agents');
  assert.deepEqual(initial[0].metadata, { dshSkillsConsole: { disabled: true } });

  // 1. 项目级覆写：alpha 为 auto（项目内解禁），beta 为 hidden（项目内隐藏）
  writeProjectOverride(project, 'alpha', 'auto');
  writeProjectOverride(project, 'beta', 'hidden');

  const listInProject = await provider.list({ cwd: project });
  assert.equal(listInProject.length, 1);
  assert.equal(listInProject[0].name, 'beta', 'beta 被项目级 hidden 报告为停用候选');
  assert.equal(listInProject[0].source, 'project-override');
  assert.deepEqual(listInProject[0].metadata, { dshSkillsConsole: { projectOverride: true } });

  // 2. 在另一个项目或无 cwd 目录下：alpha 依然停用，beta 依然启用
  const listOutside = await provider.list({});
  assert.equal(listOutside.length, 1);
  assert.equal(listOutside[0].name, 'alpha');

  // 3. get: 校验正文回读
  const betaCandidate = listInProject[0];
  const betaDoc = await provider.get(betaCandidate, { cwd: project });
  assert.equal(betaDoc.name, 'beta');
  assert.equal(betaDoc.source, 'project-override');
  assert.equal(betaDoc.invocation.modelInvocable, false);

  // 4. get: 对被项目级 unmask 的 alpha，在项目内返回 undefined
  const alphaCandidate = initial[0];
  const alphaInProjectDoc = await provider.get(alphaCandidate, { cwd: project });
  assert.equal(alphaInProjectDoc, undefined, '项目内已解禁，policy get 返回 undefined');

  // 但在项目外 alphaDoc 依然能拿到
  const alphaOutsideDoc = await provider.get(alphaCandidate, {});
  assert.equal(alphaOutsideDoc.name, 'alpha');

  fs.rmSync(root, { recursive: true, force: true });
});
