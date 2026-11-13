# 技能控制台（dsh-skills-console）功能扩展需求规格说明书

> **文档状态**：需求审查通过 / 技术方案就绪  
> **基线版本**：`0.8.15` / `@penguy-up/dsh-skills-console`  
> **设计基准**：严格遵循 [AGENTS.md](../AGENTS.md) 与 [docs/internals.md](internals.md) 硬约束（不手写 canonical / 软链四态 / v3 lock 事务一致性 / 客户端零重依赖 / 离线单测全覆盖）。

---

## 一、需求总览

本次扩展聚焦于已安装技能的**资产归集、组织展现、批量控制**以及**从全局走向项目隔离的进阶治理**：

1. **自动识别本机已有 Skills 的上游来源（`owner/repo`）**
2. **「已安装」视图支持按来源（`owner/repo`）分组展示**
3. **支持按来源批量启用 / 禁用 Skills**
4. **支持项目级（Project-level）Skills 视图与独立启停**

---

## 二、需求 1：自动识别本机已有 Skills 的上游来源

### 1.1 场景与痛点
- 首次纳管 `~/.agents/skills` 时，因历史安装缺少 lock 元数据，部分已有技能被标记为 `source: null`（本地技能）。
- 本地技能无法检测上游更新、无法拉取提交历史，重新安装存在覆盖本地改动的风险。

### 1.2 触发时机
- 添加订阅或刷新快照时自动比对；
- 工具栏或未归源行内提供「智能识别来源」手动触发；
- 定时检测与接管补偿流程。

### 1.3 匹配识别算法设计

采用三级渐进比对管道，防止同名不同内容的技能被错误关联：

```
Level 1: 强匹配（name 一致 且 treeSha / contentHash 一致）
  └─► 自动关联 source / ref / skillPath，置信度 High（直接生效）

Level 2: 结构匹配（name 一致 且 存在于订阅快照路径中）
  └─► 比对 frontmatter 标题与描述相似度
        ├─► 高相似度：提示发现可能来源，置信度 Medium（需用户点击确认）
        └─► 差异过大：保持 local / 未归源
```

- **Level 1（完全对拍，自动补齐）**：
  - 本地技能名称与订阅快照中条目名称完全一致；
  - 且本地 Git Tree SHA（`gitTreeSha`）或内容哈希（`contentHashWithoutInvocation`）与快照中的 SHA 完全一致；
  - 行为：无需询问，直接将 `installs[].source`、`ref`、`skillPath`、`subscriptionId` 写入 `state.json`，更新状态置为 `current`。
- **Level 2（名称命中但内容有改动）**：
  - 本地技能与仓库条目名称一致，但哈希不一致（用户本地改过，或上游已发新提交）；
  - 行为：行内展示「发现可能来源: `owner/repo`」，由用户二次确认后关联，标记为 `locally-modified`，保留更新前的确认机制。

### 1.4 边界防线
- **绝不破坏已有有效来源**：已存在 `source` 的技能直接跳过。
- **无副作用**：关联只补齐 `state.json` 记账元数据，不下载、不重写技能目录文件。

---

## 三、需求 2：「已安装」视图支持按来源分组展示

### 2.1 交互设计
- 工具栏视图切换器拓展为三态分段控制器：
  - **平铺 (`view.flat`)**：现有默认行为。
  - **按来源 (`view.source`)**：【新增】按 `owner/repo` 聚合折叠展示。
  - **按 Agent (`view.agent`)**：现有行为，按外导 Agent 聚合。

### 2.2 分组视图结构
- **来源组 (`owner/repo`)**：
  - 标题显示 GitHub 仓库全名（支持外链跳转）及该仓库下安装技能数量；
  - 组头提供组级批量调用策略控制开关；
  - 支持组折叠/展开，展开状态持久化于 `localStorage`。
- **本地未知来源组 (`local`)**：
  - 聚合所有 `source == null` 的技能；
  - 组头提供「一键扫描识别来源」入口。

---

## 四、需求 3：支持按来源批量启用 / 禁用 Skills

### 3.1 批量操作语义设计

| 组级动作 | 对应底层策略 | 行为与安全边界 |
|---|---|---|
| **全部设为「自动」** | `mode: 'auto'` | - 针对 `hidden` 的技能执行 `unpark`（改名回 `SKILL.md` 并清理 marker）；<br>- 针对 `manual` 的技能还原 frontmatter；<br>- **作者原声明保护**：若作者原本写了 `disable-model-invocation: true`，跳过该技能并提示「保留作者原声明」。 |
| **全部设为「仅手动」** | `mode: 'manual'` | - 修改 frontmatter 注入 `disable-model-invocation: true`；<br>- 保留 BOM/CRLF/注释，修改前在 `backups/invocation/` 留备份；<br>- `/` 斜杠命令仍可调用，模型自动识别关闭。 |
| **全部设为「完全停用」** | `mode: 'hidden'` | - 触发 A′ park 逻辑：将 `SKILL.md` 改名为 `SKILL.md.disabled` 并写入 marker；<br>- 所有 Agent 完全不可见，停用期间冻结更新与安装操作。 |

### 3.2 事务与容错设计
- **串行队列执行**：通过 `ctx.runtime.enqueue` 串行执行批量文件 I/O，防止并发锁死。
- **容错反馈**：单个技能因权限或文件外部锁定失败不阻塞其余技能，操作结果由顶部居中 `ToastStack` 反馈（成功数、跳过数、失败数）。

---

## 五、需求 4：支持项目级 Skills 视图与独立启停

### 5.1 难点与核心原则
- DSH 扫描根 Rank 规则：项目级目录（Rank 100/200）优先于全局 Canonical（Rank 500）。
- **硬边界**：在项目作用域停用全局技能时，**严禁修改全局 `~/.agents/skills` 磁盘文件，严禁污染全局 `state.json`**。

### 5.2 解决方案：基于 `cwd` 的层级策略覆盖模型 (Scoped Policy Override)

#### 1. 作用域切换 (Scope Switcher)
- 界面页头新增作用域选择器：
  - `🌐 全局环境 (~/.agents/skills)`（默认）
  - `📁 当前项目 (<当前项目名>)`（根据 DSH 当前工作区自动感知，支持手动切换路径）

#### 2. 项目级状态持久化
- 配置文件落点：`<projectRoot>/.dsh/skills-console.json`
- 结构示例：
  ```json
  {
    "version": 1,
    "overrides": {
      "git-kit": {
        "mode": "hidden",
        "reason": "disabled for this project",
        "updatedAt": "2026-11-13T16:30:00.000Z"
      }
    }
  }
  ```
- 优势：
  - 不污染全局状态；
  - 可提交至项目 git 仓库实现团队协作共享。

#### 3. Policy Provider 联动
- `lib/core/policy.ts` 的 `list({ cwd, agentId })` 已接收 `cwd` 参数。
- 当 `cwd` 处于某项目内时，加载该项目的 `.dsh/skills-console.json`；
- 对配置了覆盖停用的技能，Policy Provider 直接在 live agent scope 注入同名且 `modelInvocable: false, userInvocable: false` 的虚拟候选；
- 达成“仅在当前项目生效停用，全局及其他项目保持开启”的目标。

---

## 六、接口契约与数据模型变更

### 6.1 Host 路由变更 (`lib/routes.ts`)
- `POST /api/morehao/skills-console/skills/match-sources`：批量识别来源
- `POST /api/morehao/skills-console/skills/batch-invocation`：按来源批量调整策略
- `GET /api/morehao/skills-console/project/state?cwd=<path>`：获取项目级覆盖状态
- `POST /api/morehao/skills-console/project/invocation`：更新项目级启停覆盖

### 6.2 状态契约扩充 (`lib/contract/state.d.ts`)
- 全局 `InstallRecord` 增加 `inferredSource` 元数据字段；
- 新增 `ProjectSkillsConfig` 项目配置类型定义。

---

## 七、实施路线图与测试策略

1. **Phase 1: 按来源分组展示**
   - Client 端分段控件与视图渲染、双语 copy 更新；
   - 验证点：`npm run check:client`、折叠持久化、无来源分类。
2. **Phase 2: 自动识别已有技能来源**
   - 匹配引擎算法实现、快照 Hash 对拍与补齐接口；
   - 验证点：离线单测覆盖 Hash 一致自动绑定、Hash 漂移提示二次确认。
3. **Phase 3: 按来源批量启停**
   - 组级控制组件、串行事务队列、作者原声明保护；
   - 验证点：单测覆盖批量 A′ Park、Frontmatter 还原、只读保护。
4. **Phase 4: 项目级视图与独立启停**
   - Scope Switcher 交互、项目 `.dsh/skills-console.json` 读写、`cwd` Policy 注入；
   - 验证点：跨项目多作用域启停隔离测试，验证全局文件零污染。

---

## 八、后续上线 README.md 同步规范

功能开发与测试验收通过后，在发布 PR 前必须同步更新中英双份 README：
1. **「功能」表格**：更新清单来源识别、批量启停与项目级启停能力说明；
2. **「界面」章节**：补充「按来源分组」与「项目作用域切换」图文；
3. **「数据与配置」**：增加 `<projectRoot>/.dsh/skills-console.json` 说明；
4. **「边界（明确不做）」**：修订项目级启停相关表述。
