# 账号存档系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 玩家在开始页输入账号名（无密码），存档按账号作用域隔离；`accountId` 预留为将来后端用户标识。

**Architecture:** 新增纯逻辑 `AccountService`（注入 KV 存储，tsx 可单测）管账号校验/当前账号/本机列表/`save_<id>` 键/老档迁移；`DataService.LocalDataSource` 的存储键改为按当前账号取，`IDataSource` 接口不变（玩法系统零改动）；`BattleEntry` 开始页加账号行 + 账号面板（EditBox+账号列表），切账号即清 `PlayerDataStore` 缓存并重跑现有读档链。

**Tech Stack:** Cocos Creator 3.8.8 TypeScript；单测 tsx + node:assert/strict（项目既有模式）。

**Spec:** `docs/superpowers/specs/2026-07-07-account-save-design.md`

## Global Constraints

- 分支：从当前 `feat/gem-inscription` 切 `feat/account-save`（执行前按 superpowers:using-git-worktrees 建隔离工作区）。
- commit 用中文、结尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 纯逻辑文件（AccountService、tools/ 测试）**不得 import 'cc'**。
- 账号名规则（spec 原文）：`trim` 后 1~20 字符，仅允许中英文、数字、下划线；正则 `/^[0-9A-Za-z_一-龥]{1,20}$/`。
- 存储键名（spec 原文，不得改动）：`account_current`（当前账号）、`account_index`（账号列表 JSON 数组）、`save_<accountId>`（每账号存档）、旧键 `idle_save_v1`（迁移后删除）。
- 默认账号：`guest`。
- `IDataSource` 接口签名不变：`load(): Promise<PlayerData>` / `save(data): Promise<void>`。

---

### Task 1: AccountService 纯逻辑 + 单测

**Files:**
- Create: `assets/scripts/core/data/AccountService.ts`
- Create: `tools/account-test.ts`
- Modify: `package.json`（scripts 加一行）

**Interfaces:**
- Consumes: 无（零依赖纯逻辑）。
- Produces（Task 2/3 依赖，签名必须一致）:
  - `interface KVStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }`
  - `const DEFAULT_ACCOUNT = 'guest'`
  - `function normalizeAccountId(raw: string): string | null`
  - `class AccountService { constructor(storage: KVStorage); currentAccount(): string; setCurrentAccount(raw: string): boolean; listAccounts(): string[]; saveKeyFor(id: string): string; currentSaveKey(): string; migrateLegacy(): void; }`

- [ ] **Step 1: 写失败的测试 `tools/account-test.ts`**

```ts
// 账号服务单测（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { AccountService, normalizeAccountId, DEFAULT_ACCOUNT, KVStorage } from '../assets/scripts/core/data/AccountService';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

function fakeStorage(init: Record<string, string> = {}): KVStorage & { data: Record<string, string> } {
    const data: Record<string, string> = { ...init };
    return {
        data,
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = v; },
        removeItem: (k) => { delete data[k]; },
    };
}

test('normalize：合法（中英文/数字/下划线，1~20 字）', () => {
    assert.equal(normalizeAccountId('a'), 'a');
    assert.equal(normalizeAccountId('  Ab_1中文  '), 'Ab_1中文');
    assert.equal(normalizeAccountId('a'.repeat(20)), 'a'.repeat(20));
});

test('normalize：非法（空/纯空格/超长/空格/连字符）', () => {
    assert.equal(normalizeAccountId(''), null);
    assert.equal(normalizeAccountId('   '), null);
    assert.equal(normalizeAccountId('a'.repeat(21)), null);
    assert.equal(normalizeAccountId('a b'), null);
    assert.equal(normalizeAccountId('a-b'), null);
});

test('currentAccount：缺失/损坏回退 guest', () => {
    assert.equal(new AccountService(fakeStorage()).currentAccount(), DEFAULT_ACCOUNT);
    assert.equal(new AccountService(fakeStorage({ account_current: '  !!bad!!  ' })).currentAccount(), DEFAULT_ACCOUNT);
});

test('setCurrentAccount：合法写入并并入索引（去重）', () => {
    const s = fakeStorage();
    const svc = new AccountService(s);
    assert.equal(svc.setCurrentAccount('alice'), true);
    assert.equal(svc.currentAccount(), 'alice');
    assert.deepEqual(svc.listAccounts(), ['alice']);
    assert.equal(svc.setCurrentAccount('alice'), true);
    assert.deepEqual(svc.listAccounts(), ['alice']);
    assert.equal(svc.setCurrentAccount('bob'), true);
    assert.deepEqual(svc.listAccounts(), ['alice', 'bob']);
});

test('setCurrentAccount：非法拒绝且不改存储', () => {
    const s = fakeStorage();
    const svc = new AccountService(s);
    assert.equal(svc.setCurrentAccount(' '), false);
    assert.equal(s.getItem('account_current'), null);
});

test('listAccounts：索引损坏自愈为 [当前账号] 并写回', () => {
    const s = fakeStorage({ account_current: 'alice', account_index: '{oops' });
    const svc = new AccountService(s);
    assert.deepEqual(svc.listAccounts(), ['alice']);
    assert.equal(s.getItem('account_index'), JSON.stringify(['alice']));
});

test('listAccounts：索引里非法项被过滤', () => {
    const s = fakeStorage({ account_index: JSON.stringify(['alice', ' ', 'a-b', 'bob', 'alice']) });
    assert.deepEqual(new AccountService(s).listAccounts(), ['alice', 'bob']);
});

test('saveKeyFor / currentSaveKey：键作用域随当前账号变化', () => {
    const s = fakeStorage();
    const svc = new AccountService(s);
    assert.equal(svc.saveKeyFor('alice'), 'save_alice');
    assert.equal(svc.currentSaveKey(), 'save_guest');
    svc.setCurrentAccount('bob');
    assert.equal(svc.currentSaveKey(), 'save_bob');
});

test('两账号存档互不串档（模拟 load/save 键）', () => {
    const s = fakeStorage();
    const svc = new AccountService(s);
    svc.setCurrentAccount('alice');
    s.setItem(svc.currentSaveKey(), '{"gold":1}');
    svc.setCurrentAccount('bob');
    s.setItem(svc.currentSaveKey(), '{"gold":2}');
    assert.equal(s.getItem('save_alice'), '{"gold":1}');
    assert.equal(s.getItem('save_bob'), '{"gold":2}');
});

test('migrateLegacy：旧档拷到 save_guest 并删旧键；幂等', () => {
    const s = fakeStorage({ idle_save_v1: '{"gold":9}' });
    const svc = new AccountService(s);
    svc.migrateLegacy();
    assert.equal(s.getItem('save_guest'), '{"gold":9}');
    assert.equal(s.getItem('idle_save_v1'), null);
    svc.migrateLegacy(); // 二次调用无副作用
    assert.equal(s.getItem('save_guest'), '{"gold":9}');
});

test('migrateLegacy：save_guest 已存在则不覆盖，但仍删旧键', () => {
    const s = fakeStorage({ idle_save_v1: '{"gold":9}', save_guest: '{"gold":100}' });
    new AccountService(s).migrateLegacy();
    assert.equal(s.getItem('save_guest'), '{"gold":100}');
    assert.equal(s.getItem('idle_save_v1'), null);
});

console.log(`\nAccountService：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 在 `package.json` 的 scripts 里、`"test:reward-types"` 一行附近加：**

```json
"test:account": "tsx tools/account-test.ts",
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm run test:account`
Expected: FAIL（模块不存在 `Cannot find module '../assets/scripts/core/data/AccountService'`）

- [ ] **Step 4: 实现 `assets/scripts/core/data/AccountService.ts`**

```ts
// 账号服务（纯逻辑，不依赖 cc）：账号名校验、当前账号、本机账号列表、按账号的存档键、老档迁移。
// accountId 同时是将来后端接入的用户标识（RemoteDataSource 从这里读身份），
// 见 docs/superpowers/specs/2026-07-07-account-save-design.md。

export interface KVStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export const DEFAULT_ACCOUNT = 'guest';
const KEY_CURRENT = 'account_current';
const KEY_INDEX = 'account_index';
const LEGACY_SAVE_KEY = 'idle_save_v1';
const SAVE_PREFIX = 'save_';
const ID_RE = /^[0-9A-Za-z_一-龥]{1,20}$/;

// 校验并规范化账号名：trim 后 1~20 字符（中英文/数字/下划线）；非法返回 null。
export function normalizeAccountId(raw: string): string | null {
    const id = (raw ?? '').trim();
    return ID_RE.test(id) ? id : null;
}

export class AccountService {
    constructor(private readonly storage: KVStorage) {}

    // 当前账号；键缺失/损坏回退默认账号（不写回，写入只发生在 setCurrentAccount）。
    currentAccount(): string {
        return normalizeAccountId(this.storage.getItem(KEY_CURRENT) ?? '') ?? DEFAULT_ACCOUNT;
    }

    // 设当前账号并并入本机账号列表（去重）；非法账号名返回 false 且不动存储。
    setCurrentAccount(raw: string): boolean {
        const id = normalizeAccountId(raw);
        if (!id) return false;
        this.storage.setItem(KEY_CURRENT, id);
        const list = this.listAccounts();
        if (!list.includes(id)) {
            list.push(id);
            this.storage.setItem(KEY_INDEX, JSON.stringify(list));
        }
        return true;
    }

    // 本机已有账号列表；键损坏/为空时自愈为 [当前账号] 并写回。
    listAccounts(): string[] {
        const raw = this.storage.getItem(KEY_INDEX);
        if (raw) {
            try {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    const ids = arr.map(v => normalizeAccountId(String(v))).filter((v): v is string => !!v);
                    const deduped = [...new Set(ids)];
                    if (deduped.length > 0) return deduped;
                }
            } catch { /* 损坏走下方自愈 */ }
        }
        const fallback = [this.currentAccount()];
        this.storage.setItem(KEY_INDEX, JSON.stringify(fallback));
        return fallback;
    }

    saveKeyFor(id: string): string {
        return SAVE_PREFIX + id;
    }

    currentSaveKey(): string {
        return this.saveKeyFor(this.currentAccount());
    }

    // 老档迁移：无账号旧档（idle_save_v1）→ save_guest；已有 save_guest 不覆盖；
    // 旧键一律删除（避免二次迁移歧义）；幂等。
    migrateLegacy(): void {
        const legacy = this.storage.getItem(LEGACY_SAVE_KEY);
        if (legacy === null) return;
        if (this.storage.getItem(this.saveKeyFor(DEFAULT_ACCOUNT)) === null) {
            this.storage.setItem(this.saveKeyFor(DEFAULT_ACCOUNT), legacy);
        }
        this.storage.removeItem(LEGACY_SAVE_KEY);
    }
}
```

- [ ] **Step 5: 跑测试确认全过**

Run: `npm run test:account`
Expected: PASS（11 通过，0 失败，退出码 0）

- [ ] **Step 6: Commit（连同 spec 与本计划一起首提）**

```bash
git add assets/scripts/core/data/AccountService.ts tools/account-test.ts package.json docs/superpowers/specs/2026-07-07-account-save-design.md docs/superpowers/plans/2026-07-07-account-save.md
git commit -m "feat(存档): 账号服务纯逻辑落地——账号名校验/当前账号/本机列表/老档迁移 + 11 项单测

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: DataService 键作用域 + PlayerDataStore 缓存重置

**Files:**
- Modify: `assets/scripts/core/data/DataService.ts`（LocalDataSource，约 40~61 行）
- Modify: `assets/scripts/core/data/PlayerDataStore.ts`

**Interfaces:**
- Consumes: Task 1 的 `AccountService`。
- Produces（Task 3 依赖）:
  - `DataService.ts` 新增导出：`export const Accounts: AccountService`（绑 `sys.localStorage` 的单例）。
  - `PlayerDataStore.ts` 新增导出：`export function resetPlayerDataCache(): void`。
  - `IDataSource` 接口与 `DataService` 导出保持原样。

- [ ] **Step 1: 改 `DataService.ts`**

顶部加 import：

```ts
import { AccountService } from './AccountService';
```

`LocalDataSource` 整体替换为（删除原 `private static KEY`）：

```ts
// 账号服务单例：绑真实 localStorage。accountId 即将来后端的用户标识。
export const Accounts = new AccountService(sys.localStorage);

// 本地数据源（现在用）。微信小游戏里 sys.localStorage 会自动用微信的本地存储。
// 存档键按当前账号作用域隔离（save_<accountId>），一档损坏不连累别档。
class LocalDataSource implements IDataSource {
    async load(): Promise<PlayerData> {
        Accounts.migrateLegacy();  // 旧无账号存档首载自动迁入 guest，幂等
        const raw = sys.localStorage.getItem(Accounts.currentSaveKey());
        if (!raw) return defaultData();
        try {
            // 用默认值兜底，避免以后加了新字段时老存档缺字段报错
            return { ...defaultData(), ...JSON.parse(raw) };
        } catch {
            return defaultData();
        }
    }

    async save(data: PlayerData): Promise<void> {
        sys.localStorage.setItem(Accounts.currentSaveKey(), JSON.stringify(data));
    }
}
```

文件头注释第 4~5 行改为：

```ts
// 以后接后端：新写一个 RemoteDataSource 实现同一个接口（用户身份 = Accounts.currentAccount()），
//             只把文件最下面那一行换成 new RemoteDataSource()，玩法代码一行不用改。
```

- [ ] **Step 2: 改 `PlayerDataStore.ts`**

把 `clearPlayerDataCacheForTest` 替换为：

```ts
// 切账号/测试时清缓存：下次 loadPlayerData 会按当前账号重新读档。
export function resetPlayerDataCache(): void {
    _cache = null;
}

export function clearPlayerDataCacheForTest(): void {
    resetPlayerDataCache();
}
```

- [ ] **Step 3: 回归现有测试（接口未变，应全绿）**

Run: `npm run test:account && npm run test:services && npm run test:inventory && npm run test:progression && npm run test:combat && npm run test:squad && npm run test:growth && npm run test:inlay`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add assets/scripts/core/data/DataService.ts assets/scripts/core/data/PlayerDataStore.ts
git commit -m "feat(存档): 存档键按账号作用域隔离——DataService 接 AccountService，缓存可重置

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: BattleEntry 开始页账号行 + 账号面板 + 切换重载

**Files:**
- Modify: `assets/scripts/BattleEntry.ts`
  - import 区（文件顶部）
  - 读档链（约 376~380 行）抽方法
  - `_createBootView`（约 607 行）、`_drawBootLoading`（约 680 行）、`_showStartScreen`（约 697 行）、`_drawBootArtStartScreen`（约 759 行）、`_onBootTap`（约 856 行）
  - 新增账号面板方法块（放在 SquadView 块即约 1068 行之前）

**Interfaces:**
- Consumes: `Accounts`（DataService）、`normalizeAccountId`（AccountService）、`resetPlayerDataCache`（PlayerDataStore）、cc 的 `EditBox`。
- Produces: 无对外接口（终端 UI）。

- [ ] **Step 1: 加 import**

cc 的大 import（文件顶部 `from 'cc'`）里补 `EditBox`。另外：
- `DataService` 已有 import 的话补 `Accounts`；没有则加 `import { Accounts } from './core/data/DataService';`
- 加 `import { normalizeAccountId } from './core/data/AccountService';`
- `PlayerDataStore` 既有 import（`loadPlayerData` 处）补 `resetPlayerDataCache`。

- [ ] **Step 2: 抽取读档链为 `_loadAllPlayerData()`**

onLoad 里（约 376~380 行）原 `const dataReady = loadInventory(this._inv).then(...)...catch(...)` 整段替换为：

```ts
const dataReady = this._loadAllPlayerData();
```

并在 `_startBattle` 定义之前新增方法（与原链逐环相同，含离线结算）：

```ts
// 完整读档链：冷启动与切账号共用。所有 Model 原位重灌（deserialize/重赋值），
// 视图持有的引用不失效。
private _loadAllPlayerData(): Promise<void> {
    return loadInventory(this._inv)
        .then(() => loadProgress(this._progress))
        .then(() => this._claimOfflineRewards())
        .then(() => loadChests(this._chests))
        .then(() => this._refreshMaterialsCache())
        .then(() => loadSquad())
        .then((squad) => { this._squad = squad; })
        .then(() => loadGrowth())
        .then((growth) => { this._growth = growth; })
        .then(() => { this._invView.refresh(); })
        .catch(() => {
            // 读档失败时仍允许进游戏，掉落会从空背包开始存。
        });
}
```

- [ ] **Step 3: 加字段（放在 `_bootPressed` 附近，约 215 行）**

```ts
private _bootAccountLabel: Label = null!;
private _bootAccountRect: { x: number; y: number; w: number; h: number } | null = null;
// ===== 账号面板（占位）：EditBox 输入 + 本机账号列表 + 确认切换，镜像 SquadView =====
private _accountRoot: Node | null = null;
private _accountGfx: Graphics = null!;
private _accountLabels: Label[] = [];
private _accountHots: { rect: { x: number; y: number; w: number; h: number }; act: () => void }[] = [];
private _accountEdit: EditBox | null = null;
private _accountHint = '';
private _accountSwitching = false;
```

- [ ] **Step 4: 开始页账号行**

`_createBootView` 里 `this._bootButton = this._makeBootLabel('BootButton');` 之后加：

```ts
this._bootAccountLabel = this._makeBootLabel('BootAccount');
```

`_drawBootLoading` 开头 `this._bootButtonRect = null;` 之后加：

```ts
this._bootAccountRect = null;
if (this._bootAccountLabel) this._bootAccountLabel.node.active = false;
```

`_showStartScreen` 文字回退分支，`this._placeBootLabel(this._bootButton, '开始游戏', ...)` 之后加：

```ts
this._drawBootAccountRow(0, buttonY - 44, new Color(83, 74, 62));
```

`_drawBootArtStartScreen` 末尾（`this._bootButtonRect = ...` 之后）加：

```ts
this._drawBootAccountRow(0, r.y - r.h / 2 - 40, new Color(240, 232, 210));
```

新增方法（放在 `_drawBootArtStartScreen` 之后）：

```ts
// 开始页账号行：显示当前账号，点击打开账号面板。美术/文字两种开始页都调用。
private _drawBootAccountRow(x: number, y: number, color: Color) {
    if (!this._bootAccountLabel) return;
    this._bootAccountLabel.node.active = true;
    this._placeBootLabel(this._bootAccountLabel, `账号：${Accounts.currentAccount()}  [切换]`, x, y, 520, 40, 22, color);
    this._bootAccountRect = { x: x - 260 / 2, y: y - 20, w: 260, h: 40 };
}
```

- [ ] **Step 5: 点击响应**

`_onBootTap` 里 `if (this._bootPhase !== 'ready' || !hit) return;` 之前加：

```ts
if (this._bootPhase === 'ready' && this._bootAccountHit(e)) {
    this._openAccountPanel();
    return;
}
```

`_bootButtonHit` 之后新增：

```ts
private _bootAccountHit(e: EventTouch): boolean {
    if (!this._bootAccountRect) return false;
    const ui = e.getUILocation();
    const p = this._bootRoot.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
    const r = this._bootAccountRect;
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
```

- [ ] **Step 6: 账号面板（新方法块，放在 `_createSquadView` 之前）**

```ts
// ===== 账号面板：仅开始页（ready 阶段）可开；确认切换后清缓存重跑读档链 =====

private _accountPanelOpen(): boolean { return !!this._accountRoot && this._accountRoot.active; }

private _ensureAccountPanel() {
    if (this._accountRoot) return;
    const root = new Node('AccountView');
    root.layer = this.node.layer;
    root.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
    const gfxNode = new Node('AccountGfx');
    gfxNode.layer = this.node.layer;
    gfxNode.addComponent(UITransform);
    this._accountGfx = gfxNode.addComponent(Graphics);
    root.addChild(gfxNode);

    // EditBox：程序化创建，需手工挂 textLabel/placeholderLabel
    const ebNode = new Node('AccountInput');
    ebNode.layer = this.node.layer;
    ebNode.addComponent(UITransform).setContentSize(360, 60);
    const textNode = new Node('TEXT_LABEL');
    textNode.layer = this.node.layer;
    textNode.addComponent(UITransform).setContentSize(340, 52);
    const textLabel = textNode.addComponent(Label);
    textLabel.fontSize = 26;
    textLabel.color = new Color(58, 48, 36);
    ebNode.addChild(textNode);
    const phNode = new Node('PLACEHOLDER_LABEL');
    phNode.layer = this.node.layer;
    phNode.addComponent(UITransform).setContentSize(340, 52);
    const phLabel = phNode.addComponent(Label);
    phLabel.fontSize = 26;
    phLabel.color = new Color(150, 140, 125);
    phLabel.string = '输入账号名';
    ebNode.addChild(phNode);
    const eb = ebNode.addComponent(EditBox);
    eb.textLabel = textLabel;
    eb.placeholderLabel = phLabel;
    eb.maxLength = 20;
    root.addChild(ebNode);
    ebNode.setPosition(0, 340, 0);
    this._accountEdit = eb;

    this.node.addChild(root);
    root.active = false;
    // TOUCH_START 也要接住并吞掉，否则触摸会被下层 BootFlow 认领
    root.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, this);
    root.on(Node.EventType.TOUCH_END, this._onAccountTap, this);
    this._accountRoot = root;
}

private _openAccountPanel() {
    this._ensureAccountPanel();
    this._accountHint = '';
    this._accountSwitching = false;
    if (this._accountEdit) this._accountEdit.string = Accounts.currentAccount();
    this._accountRoot!.active = true;
    this._accountRoot!.setSiblingIndex(this.node.children.length - 1);
    this._renderAccountPanel();
}

private _closeAccountPanel() {
    if (this._accountRoot) this._accountRoot.active = false;
}

// 面板本地 Label 工厂：挂 _accountRoot，隐藏面板即整体消失（镜像 _squadLabel）。
private _accountLabel(i: number): Label {
    while (i >= this._accountLabels.length) {
        const n = new Node('AccountLbl');
        n.layer = this._accountRoot!.layer;
        n.addComponent(UITransform);
        const lb = n.addComponent(Label);
        this._accountRoot!.addChild(n);
        this._accountLabels.push(lb);
    }
    return this._accountLabels[i];
}

private _renderAccountPanel() {
    const g = this._accountGfx;
    g.clear();
    this._accountHots.length = 0;
    for (const l of this._accountLabels) l.node.active = false;
    let li = 0;
    const label = (s: string, x: number, y: number, size = 24, color?: Color) => {
        const lb = this._accountLabel(li++);
        lb.node.active = true; lb.string = s; lb.fontSize = size;
        lb.color = color ?? new Color(235, 228, 210);
        lb.node.setPosition(x, y, 0);
    };

    // 半透明底板
    g.fillColor = new Color(20, 24, 30, 230);
    g.rect(-this._halfW, -this._halfH, this._halfW * 2, this._halfH * 2);
    g.fill();

    label('切换账号', 0, 470, 30);
    label('账号将用于记录你的存档（将来接后端同步）', 0, 425, 20, new Color(160, 152, 138));

    // 输入框衬底（EditBox 自身无背景图）
    g.fillColor = new Color(238, 230, 210, 255);
    g.roundRect(-180, 310, 360, 60, 8);
    g.fill();

    // 提示行：红=错误，灰=切换中
    if (this._accountHint) {
        label(this._accountHint, 0, 262, 20, this._accountSwitching ? new Color(180, 176, 165) : new Color(220, 90, 80));
    }

    // 本机已有账号列表（最多列 6 个，点选填入输入框）
    const list = Accounts.listAccounts().slice(0, 6);
    label('本机账号（点选填入）', 0, 210, 22, new Color(160, 152, 138));
    const rowH = 72, x0 = -240, rowW = 480;
    let y = 150;
    for (const id of list) {
        const cur = id === Accounts.currentAccount();
        g.fillColor = cur ? new Color(64, 84, 66, 255) : new Color(48, 58, 72, 255);
        g.roundRect(x0, y - rowH / 2, rowW, rowH - 10, 10);
        g.fill();
        label(cur ? `${id}（当前）` : id, 0, y, 24);
        const rid = id;
        this._accountHots.push({
            rect: { x: x0, y: y - rowH / 2, w: rowW, h: rowH - 10 },
            act: () => { if (this._accountEdit) this._accountEdit.string = rid; },
        });
        y -= rowH;
    }

    // 确认 / 取消
    g.fillColor = new Color(74, 96, 76, 255);
    g.roundRect(-220, -560, 200, 70, 12); g.fill();
    label('确认', -120, -525, 26);
    this._accountHots.push({ rect: { x: -220, y: -560, w: 200, h: 70 }, act: () => { void this._onAccountConfirm(); } });
    g.fillColor = new Color(120, 60, 60, 255);
    g.roundRect(20, -560, 200, 70, 12); g.fill();
    label('取消', 120, -525, 26);
    this._accountHots.push({ rect: { x: 20, y: -560, w: 200, h: 70 }, act: () => this._closeAccountPanel() });
}

private _onAccountTap(e: EventTouch) {
    e.propagationStopped = true;
    if (this._accountSwitching) return;   // 切换中屏蔽所有操作
    const ui = e.getUILocation();
    const p = this._accountRoot!.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
    for (const h of this._accountHots) {
        if (p.x >= h.rect.x && p.x <= h.rect.x + h.rect.w && p.y >= h.rect.y && p.y <= h.rect.y + h.rect.h) {
            h.act();
            return;
        }
    }
}

private async _onAccountConfirm() {
    const raw = this._accountEdit ? this._accountEdit.string : '';
    const id = normalizeAccountId(raw);
    if (!id) {
        this._accountHint = '账号名需 1~20 字：中英文/数字/下划线';
        this._renderAccountPanel();
        return;
    }
    if (id === Accounts.currentAccount()) {
        this._closeAccountPanel();
        return;
    }
    // 先落盘当前账号指针（防半切换状态），再清缓存重跑读档链
    this._accountSwitching = true;
    this._accountHint = '读取存档中...';
    this._renderAccountPanel();
    Accounts.setCurrentAccount(id);
    resetPlayerDataCache();
    this._offlineNoticeText = '';
    this._offlineNoticeTtl = 0;
    await this._loadAllPlayerData();
    this._accountSwitching = false;
    this._closeAccountPanel();
    this._showStartScreen();   // 刷新账号行 + 新账号的离线收益提示
}
```

- [ ] **Step 7: 回归 + 人工验证点**

Run: `npm run test:account && npm run test:inventory && npm run test:combat && npm run test:squad`
Expected: 全部 PASS（BattleEntry 无单测，逻辑不进测试链）

人工验证（留给用户，Cocos 网页预览）：
1. 老档升级：启动后开始页显示「账号：guest」，进游戏原进度还在（迁移成功）；
2. 切换账号：开始页点账号行 → 输入新账号 → 确认 → 回开始页显示新账号，进游戏是全新档；
3. 来回切：guest ↔ 新账号，背包/关卡进度互不串档；
4. 非法名：输入空格/`a-b` → 红字提示不关面板；
5. 点选列表已有账号 → 填入输入框 → 确认生效。

- [ ] **Step 8: Commit**

```bash
git add assets/scripts/BattleEntry.ts
git commit -m "feat(存档): 开始页账号行 + 切换账号面板——切换即清缓存重跑读档链，账号间互不串档

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 记忆文档收尾

**Files:**
- Modify: `ai/memory/项目状态.md`（最近进展 + 已完成 + 待办）
- Modify: `ai/memory/代码地图.md`（存档与数据节 + BattleEntry 行）
- Modify: `ai/memory/设计日志.md`（追加决策）

**Interfaces:** 无代码接口；按 `ai/skills/开发收尾.md` 走。

- [ ] **Step 1: `ai/memory/代码地图.md` 「存档与数据」表加一行、改两行**

新增行：

```markdown
| `core/data/AccountService.ts` | 账号服务纯逻辑（不依赖 cc）：账号名校验（1~20 字中英文/数字/下划线）、当前账号/本机列表（`account_current`/`account_index`）、按账号存档键 `save_<id>`、旧档 `idle_save_v1`→`save_guest` 迁移；**accountId = 将来后端用户标识** |
```

`DataService.ts` 行职责末尾补一句：`存档键按当前账号作用域（`save_<accountId>`，经 `Accounts` 单例）`。
`PlayerDataStore.ts` 行职责末尾补一句：`切账号用 `resetPlayerDataCache()` 清缓存`。
测试表加：`tools/account-test.ts`，`npm run test:account`。
BattleEntry 行职责里补一句：`开始页账号行 + 账号面板（EditBox+本机账号列表），切账号清缓存重跑读档链`。

- [ ] **Step 2: `ai/memory/项目状态.md`**

「最近进展」顶部插一条（3~4 行）：账号存档系统落地（无密码账号名/开始页切换/老档迁 guest/键作用域隔离/accountId 预留后端用户标识），**尚未人工验证**：Cocos 预览手测切换流程。「已完成」加一条同要点；「待办」加：账号存档 Cocos 预览手测；后端接入时 RemoteDataSource 实现同接口。

- [ ] **Step 3: `ai/memory/设计日志.md` 追加**

```markdown
## 2026-07-07 账号存档：账号作用域存储键，accountId 预留为后端用户标识

- 玩家输入账号名（无密码）按账号隔离存档；键 `save_<accountId>`，`IDataSource` 接口不变（否决单键大对象：微信 1MB 上限+全毁风险；否决显式传参：调用链大动）。
- **后端预留**：accountId 就是将来后端记录数据的用户标识，`RemoteDataSource` 实现同一 `IDataSource` 并从 `Accounts.currentAccount()` 读身份，玩法代码零改动。
- 老档 `idle_save_v1` 首载自动迁 `save_guest` 并删旧键；切账号仅限开始页（运行时热切全局状态复杂度不值）。
```

- [ ] **Step 4: 全量测试回归**

Run: `npm run test:account && npm run test:inventory && npm run test:effective && npm run test:drop && npm run test:combat && npm run test:progression && npm run test:services && npm run test:craft && npm run test:skill && npm run test:squad && npm run test:growth-config && npm run test:growth && npm run test:inlay-config && npm run test:inlay && npm run test:reward-types`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add ai/memory/项目状态.md ai/memory/代码地图.md ai/memory/设计日志.md
git commit -m "docs(memory): 账号存档系统收尾——刷新项目状态/代码地图/设计日志

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
