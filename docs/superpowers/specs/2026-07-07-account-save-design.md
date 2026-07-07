# 账号存档系统设计（Account-Scoped Save）

- 日期：2026-07-07
- 状态：已与用户对齐，待实现
- 分支基线：`feat/gem-inscription`（若先合并回 master 亦兼容，改动面不与镶嵌线冲突）

## 目标

玩家在开始页输入一个**账号名**（无密码），存档按账号隔离记录；同设备可多账号切换。
**核心预留**：`accountId` 就是将来后端接入时的用户标识——后端记录数据（存档同步/埋点）都挂在这个 ID 上，`RemoteDataSource` 实现同一 `IDataSource` 接口并从 `AccountService` 读当前账号做请求身份，玩法代码零改动。

## 决策记录（用户已确认）

1. **账号形态**：纯账号名，无密码。当前阶段不引入假安全；后端接入时再做真验证。
2. **入口时机**：开始页（BootFlow ready 阶段）输入/切换，进游戏前定；战斗中不可切。
3. **老档迁移**：无账号的旧存档（`idle_save_v1`）首次加载自动迁入默认账号 `guest`，老玩家无感。
4. **实现方案**：账号作用域的存储键（方案 A）。`IDataSource` 接口不变，账号是数据源内部状态，玩法系统（背包/进度/宝箱/材料/小队/成长/镶嵌）一行不改。
   - 否决 B（单键大对象存所有账号）：微信 `setStorage` 单键 1MB 上限风险 + 每次全量序列化 + 一处损坏全毁。
   - 否决 C（`load(accountId)` 显式传参）：调用链大动，后端实际也是会话级身份，无需每次传。

## 架构

### 新模块 `assets/scripts/core/data/AccountService.ts`（纯逻辑）

注入 KV 存储接口以便 tsx 单测（模式同项目其他纯逻辑模块）：

```ts
export interface KVStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
```

职责：
- `normalizeAccountId(raw)` / 校验：`trim` 后 1~20 字符，允许中英文、数字、下划线；空串/超长/非法字符返回失败。
- `currentAccount()`：读 `account_current`，缺失/损坏回退 `'guest'`。
- `setCurrentAccount(id)`：写 `account_current` 并把 id 并入 `account_index`（去重）。
- `listAccounts()`：读 `account_index`（JSON 数组），损坏时自愈为 `[当前账号]` 重建。
- `saveKeyFor(id)`：返回 `save_<id>`。
- `migrateLegacy()`：若 `save_guest` 不存在且旧键 `idle_save_v1` 存在 → 拷贝为 `save_guest` 并**删除旧键**（避免二次迁移歧义）；幂等，二次调用无副作用。

### 存储布局（`sys.localStorage`，各自独立小键）

| 键 | 内容 |
|----|------|
| `account_current` | 当前账号 ID（记住上次登录，下次默认回填） |
| `account_index` | 本机已有账号列表（JSON 字符串数组） |
| `save_<accountId>` | 该账号的完整 `PlayerData` JSON（键作用域隔离，一档损坏不连累别档） |
| `idle_save_v1` | 旧键，迁移后删除 |

### 改动点

- `core/data/DataService.ts`：`LocalDataSource` 加载时先 `migrateLegacy()`，键从固定 `idle_save_v1` 改为 `saveKeyFor(currentAccount())`；`IDataSource` 接口**不变**。
- `core/data/PlayerDataStore.ts`：新增 `resetPlayerDataCache()`（切账号清缓存；现有 `clearPlayerDataCacheForTest` 可与之合并为同一实现）。
- `BattleEntry.ts`：开始页账号行 + 账号面板 + 切换后重跑读档链（见下）。

### 切账号数据流

```
开始页点「账号：xxx」→ 账号面板（EditBox + 本机账号列表）
→ 确认 → 校验 → 若与当前相同：直接关面板
→ 不同：AccountService.setCurrentAccount(id)（先落盘，防半切换状态）
→ resetPlayerDataCache() + 重置各内存 Model（inventory/progress/chests/materials/squad/growth）
→ 重跑现有读档链（loadInventory → loadProgress → 离线结算 claim → loadChests → 材料缓存 → loadSquad → loadGrowth）
→ 刷新各面板视图 → 回开始页，账号行显示新账号
```

注：读档链含离线结算，切入某账号即按该账号的 `lastSaveTime` 结算离线收益，行为与冷启动一致。

## UI 交互

- **开始页（ready 阶段）**：开始按钮附近加一行「账号：guest」小字 + 触摸热区；切片美术与文字回退两种形态都显示。
- **账号面板**（挂 BootFlow 层，仅 ready 阶段可开，风格同现有占位面板）：
  - `cc.EditBox` 输入框（微信小游戏拉原生键盘；网页预览可用），默认回填当前账号；
  - 下方列本机已有账号，点选填入输入框；
  - 「确认」→ 走上面数据流（切换期间显示「读取存档中...」）；「取消」关面板不动数据。
- **playing 阶段**无切换入口，避免运行时热切全局状态。

## 错误处理

- 非法账号名：面板内红字提示，不关面板、不动数据。
- `account_current` / `account_index` 损坏：自愈回退（`guest` / 重建列表），不崩。
- 切换后读档失败：沿用现有兜底（catch 后照样进游戏、从空档开始存）；`setCurrent` 已先落盘，重启后仍是新账号，无半切换状态。

## 测试

新增 `tools/account-test.ts`（tsx + fake KVStorage，不依赖 cc），挂 `npm run test:account`：

1. 账号名校验边界（空/纯空格/1 字/20 字/21 字/非法字符/中文英文数字下划线混合）。
2. 老档首登迁移：`idle_save_v1` → `save_guest`，旧键删除；二次加载不重迁；已有 `save_guest` 时不覆盖。
3. 键作用域隔离：账号 A、B 各存各的 `PlayerData`，互不串档。
4. `account_index` 去重与点选往返。
5. 损坏键自愈（`account_current`/`account_index` 写入非法 JSON 后读取不崩、回退默认）。

现有各系统单测不受影响（`IDataSource` 接口未变）。
人工验证（网页预览）：建两个账号来回切，背包/关卡进度互不串档；老档升级后 guest 无感继承。

## 明确不做（YAGNI）

- 密码/验证、账号删除/改名 UI、游戏内随时切换、云端同步——后端接入时再议。
- 不改 `PlayerData` 结构（accountId 不进存档体，身份由键作用域表达）。
