# 角色天赋系统（chartalent）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个职业一棵专属天赋树：升级得技能点（每级 1 点），投属性节点/被动节点（全部可多级，等级门槛分层解锁），免费洗点，容量 128 > 供给 99 强制取舍。

**Architecture:** 复刻心法 `talent/` 成熟管线——`chartalent.xlsx` 真源 → 导表生成 config → `chartalent/` 三纯逻辑文件（Config/Model/Stats）→ 组合根 `BattleEntry` 注入：属性走 `buildEffectiveStatsMap` 新增的按职业 `perClassStats` 参数，被动开战时追加进单位 `passives` 数组（`BattleManager` 新增可选构造参）。UI 新 `CharTalentPanel`，入口 = 主界面左上角头像热区 + SquadPanel 每角色行「天赋」按钮。

**Tech Stack:** TypeScript 5.8.2（tsconfig.game/tools 双环境）、xlsx 导表（tools/excel-to-config.ts）、tsx 单测、Cocos Creator 3.8.8（仅 UI 层）。

**Spec:** `docs/superpowers/specs/2026-07-12-char-talent-design.md`

## Global Constraints

- 纯逻辑文件（chartalent/ 三件套、导表器、种子脚本）**不依赖 cc**，可 tsx 单测。
- 注释、节点文案全中文；代码注释密度对齐 `talent/` 现有文件。
- 数值全占位（spec §3.4），后续并入 balance 框架反解；不动 `pacing-sim`/`sim:progress` 输入。
- 天赋全未点 = 零影响：所有新参数可选、缺省旧行为。
- **每任务结束只 `git add` 暂存，不提交**（用户逐次授权提交）；不推送。
- 交付前 `npm run verify` 全绿（typecheck 双环境 + 全部单测 + balance:check + sim:pacing + check:art + check:ui-alpha）。

## 占位数值总表（种子脚本与测试的共同依据）

每职业 13 节点 = 9 属性节点（各 12 级）+ 4 被动节点（各 5 级）= 128 点容量。
等级门槛分层：T1=Lv.1 / T2=Lv.5 / T3=Lv.10 / T4=Lv.20 / T5=Lv.35 / T6=Lv.50 / T7=Lv.70。
节点 id 前缀 `ct_<cls>_`；被动每级一条 PassiveDef，id = `<nodeId>_l<level>`。

新增 Buff（buff.xlsx，层数承载被动等级，duration=-1 为永久光环）：

| id | 名称 | duration | maxStacks | stackRule | statMods |
|----|------|----------|-----------|-----------|----------|
| ct_bulwark | 坚韧 | -1 | 5 | add | dmgReduce:+0.01（每层） |
| ct_shadow | 残影 | -1 | 5 | add | dodgeRate:+0.01（每层） |
| ct_inspire | 鼓舞 | -1 | 5 | add | atk%:0.01（每层） |
| ct_po_jun | 破军 | 6 | 5 | add | dmgBonus:+0.05（每层） |

---

### Task 1: chartalent.xlsx 种子脚本

**Files:**
- Create: `tools/seed-chartalent-xlsx.ts`
- Modify: `package.json`（scripts 加 `seed:chartalent`）
- 产物: `tools/config-xlsx/chartalent.xlsx`

**Interfaces:**
- Produces: `chartalent.xlsx` 两 sheet——`Nodes`（cls,id,label,tier,levelReq,maxLevel,kind,statKey,valuePerLevel）、`Passives`（nodeId,level,name,trigger,chance,targetMode,effects）。Task 2 的导表器按此列名解析。

- [ ] **Step 1: 写种子脚本**

```ts
// tools/seed-chartalent-xlsx.ts
// chartalent.xlsx 种子脚本（一次性/重建用）。
// 用途：生成 tools/config-xlsx/chartalent.xlsx，之后策划直接编辑该 xlsx。
// 两表：Nodes（角色天赋节点：职业/等级门槛/属性或被动）、Passives（被动节点每级一条 PassiveDef）。
// 数值全占位（spec 2026-07-12-char-talent-design.md §3.4）。

import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, 'config-xlsx/chartalent.xlsx');

// kind=stat：statKey 为 EquipStatKey，效果 = valuePerLevel × 已投级数（百分比 0~1 小数）。
// kind=passive：statKey/valuePerLevel 置空，每级效果见 Passives 表（只取当前级那条注入战斗）。
// levelReq：角色等级门槛（分层 1/5/10/20/35/50/70）；无节点连线依赖。
const NODES_HEADER = ['cls', 'id', 'label', 'tier', 'levelReq', 'maxLevel', 'kind', 'statKey', 'valuePerLevel'];
const NODES_ROWS: (string | number)[][] = [
    // —— tank：生存反制 ——
    ['tank', 'ct_tank_hp',        '筋骨',   1, 1,  12, 'stat', 'hpPct',        0.01],
    ['tank', 'ct_tank_def',       '铁壁',   1, 1,  12, 'stat', 'defPct',       0.01],
    ['tank', 'ct_tank_hpflat',    '蓄血',   2, 5,  12, 'stat', 'hp',           30],
    ['tank', 'ct_tank_block',     '格挡',   2, 5,  12, 'stat', 'blockRate',    0.01],
    ['tank', 'ct_tank_thorns',    '反震',   3, 10, 5,  'passive', '',          0],
    ['tank', 'ct_tank_defflat',   '淬甲',   3, 10, 12, 'stat', 'def',          2],
    ['tank', 'ct_tank_bulwark',   '坚韧',   4, 20, 5,  'passive', '',          0],
    ['tank', 'ct_tank_blockpow',  '沉肩',   4, 20, 12, 'stat', 'blockRatio',   0.015],
    ['tank', 'ct_tank_guard',     '守护',   5, 35, 5,  'passive', '',          0],
    ['tank', 'ct_tank_reduce',    '磐石',   5, 35, 12, 'stat', 'dmgReduce',    0.005],
    ['tank', 'ct_tank_atk',       '腕力',   6, 50, 12, 'stat', 'atkPct',       0.01],
    ['tank', 'ct_tank_speed',     '疾步',   6, 50, 12, 'stat', 'moveSpeedPct', 0.01],
    ['tank', 'ct_tank_warwill',   '战意',   7, 70, 5,  'passive', '',          0],
    // —— dps：爆发斩杀 ——
    ['dps', 'ct_dps_atk',         '磨剑',   1, 1,  12, 'stat', 'atkPct',          0.01],
    ['dps', 'ct_dps_atkflat',     '劲力',   1, 1,  12, 'stat', 'atk',             3],
    ['dps', 'ct_dps_crit',        '锐目',   2, 5,  12, 'stat', 'critRate',        0.005],
    ['dps', 'ct_dps_basic',       '快刃',   2, 5,  12, 'stat', 'basicDmgBonus',   0.01],
    ['dps', 'ct_dps_bloodthirst', '嗜血',   3, 10, 5,  'passive', '',             0],
    ['dps', 'ct_dps_aspd',        '轻身',   3, 10, 12, 'stat', 'attackSpeed',     0.02],
    ['dps', 'ct_dps_combo',       '连击',   4, 20, 5,  'passive', '',             0],
    ['dps', 'ct_dps_critdmg',     '重创',   4, 20, 12, 'stat', 'critDmg',         0.02],
    ['dps', 'ct_dps_pojun',       '破军',   5, 35, 5,  'passive', '',             0],
    ['dps', 'ct_dps_single',      '专注',   5, 35, 12, 'stat', 'singleDmgBonus',  0.01],
    ['dps', 'ct_dps_aoe',         '横扫',   6, 50, 12, 'stat', 'aoeDmgBonus',     0.01],
    ['dps', 'ct_dps_skill',       '御气',   6, 50, 12, 'stat', 'skillDmgBonus',   0.01],
    ['dps', 'ct_dps_shadow',      '残影',   7, 70, 5,  'passive', '',             0],
    // —— healer：团队增益 ——
    ['healer', 'ct_healer_hp',      '养气', 1, 1,  12, 'stat', 'hpPct',        0.01],
    ['healer', 'ct_healer_atk',     '灵枢', 1, 1,  12, 'stat', 'atkPct',       0.01],
    ['healer', 'ct_healer_haste',   '凝思', 2, 5,  12, 'stat', 'skillHaste',   0.01],
    ['healer', 'ct_healer_def',     '云袖', 2, 5,  12, 'stat', 'defPct',       0.01],
    ['healer', 'ct_healer_rejuv',   '回春', 3, 10, 5,  'passive', '',          0],
    ['healer', 'ct_healer_hpflat',  '固元', 3, 10, 12, 'stat', 'hp',           25],
    ['healer', 'ct_healer_shelter', '庇护', 4, 20, 5,  'passive', '',          0],
    ['healer', 'ct_healer_dodge',   '飘然', 4, 20, 12, 'stat', 'dodgeRate',    0.005],
    ['healer', 'ct_healer_inspire', '鼓舞', 5, 35, 5,  'passive', '',          0],
    ['healer', 'ct_healer_speed',   '踏云', 5, 35, 12, 'stat', 'moveSpeedPct', 0.01],
    ['healer', 'ct_healer_reduce',  '柔劲', 6, 50, 12, 'stat', 'dmgReduce',    0.005],
    ['healer', 'ct_healer_atkflat', '通络', 6, 50, 12, 'stat', 'atk',          2],
    ['healer', 'ct_healer_deft',    '妙手', 7, 70, 5,  'passive', '',          0],
];

// 被动每级一条完整 PassiveDef 行；always 被动用「Buff 层数=级数」承载强度（buffedStats 按层数相乘）。
const PASSIVES_HEADER = ['nodeId', 'level', 'name', 'trigger', 'chance', 'targetMode', 'effects'];
function ladder(nodeId: string, name: string, trigger: string, targetMode: string,
    mk: (lv: number) => { chance: number; effects: string }): (string | number)[][] {
    const rows: (string | number)[][] = [];
    for (let lv = 1; lv <= 5; lv++) {
        const { chance, effects } = mk(lv);
        rows.push([nodeId, lv, name, trigger, chance, targetMode, effects]);
    }
    return rows;
}
const r2 = (v: number) => Math.round(v * 100) / 100;
const PASSIVES_ROWS: (string | number)[][] = [
    // tank：反震（受击概率反伤攻击者）/坚韧（常驻免伤）/守护（受击概率全队石肤）/战意（普攻命中概率自身战吼）
    ...ladder('ct_tank_thorns',  '反震', 'onHurt', 'trigger', lv => ({ chance: r2(0.08 + 0.02 * lv), effects: `damage:${r2(0.3 + 0.1 * lv)}` })),
    ...ladder('ct_tank_bulwark', '坚韧', 'always', 'self',    lv => ({ chance: 1, effects: `applyBuff:ct_bulwark:${lv}` })),
    ...ladder('ct_tank_guard',   '守护', 'onHurt', 'team',    lv => ({ chance: r2(0.05 + 0.01 * lv), effects: 'applyBuff:stone_skin:1' })),
    ...ladder('ct_tank_warwill', '战意', 'onHit',  'self',    lv => ({ chance: r2(0.06 + 0.02 * lv), effects: 'applyBuff:battle_cry:1' })),
    // dps：嗜血（击杀回血）/连击（普攻命中概率追伤）/破军（放技能自增全伤害）/残影（常驻闪避）
    ...ladder('ct_dps_bloodthirst', '嗜血', 'onKill', 'self',    lv => ({ chance: 1, effects: `heal:${r2(0.15 + 0.15 * lv)}` })),
    ...ladder('ct_dps_combo',       '连击', 'onHit',  'trigger', lv => ({ chance: r2(0.08 + 0.02 * lv), effects: `damage:${r2(0.3 + 0.05 * lv)}` })),
    ...ladder('ct_dps_pojun',       '破军', 'onCast', 'self',    lv => ({ chance: 1, effects: `applyBuff:ct_po_jun:${lv}` })),
    ...ladder('ct_dps_shadow',      '残影', 'always', 'self',    lv => ({ chance: 1, effects: `applyBuff:ct_shadow:${lv}` })),
    // healer：回春（放技能全队小疗）/庇护（受击概率自身石肤）/鼓舞（常驻全队攻）/妙手（放技能概率全队疗+石肤）
    ...ladder('ct_healer_rejuv',   '回春', 'onCast', 'team', lv => ({ chance: 1, effects: `heal:${r2(0.06 + 0.04 * lv)}` })),
    ...ladder('ct_healer_shelter', '庇护', 'onHurt', 'self', lv => ({ chance: r2(0.1 + 0.02 * lv), effects: 'applyBuff:stone_skin:1' })),
    ...ladder('ct_healer_inspire', '鼓舞', 'always', 'team', lv => ({ chance: 1, effects: `applyBuff:ct_inspire:${lv}` })),
    ...ladder('ct_healer_deft',    '妙手', 'onCast', 'team', lv => ({ chance: r2(0.25 + 0.05 * lv), effects: 'heal:0.05|applyBuff:stone_skin:1' })),
];

const wb = XLSX.utils.book_new();
function addSheet(name: string, header: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
}
addSheet('Nodes', NODES_HEADER, NODES_ROWS);
addSheet('Passives', PASSIVES_HEADER, PASSIVES_ROWS);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
console.log(`✓ 已生成 ${OUT}`);
console.log(`  sheets: Nodes(${NODES_ROWS.length}) Passives(${PASSIVES_ROWS.length})`);
```

- [ ] **Step 2: package.json 加脚本**

`"seed:chartalent": "tsx tools/seed-chartalent-xlsx.ts"`（插在 `seed:talent` 之后）。

- [ ] **Step 3: 运行验证**

Run: `npm run seed:chartalent`
Expected: `✓ 已生成 ...chartalent.xlsx` + `sheets: Nodes(39) Passives(60)`

- [ ] **Step 4: 暂存**

```bash
git add tools/seed-chartalent-xlsx.ts tools/config-xlsx/chartalent.xlsx package.json
```

---

### Task 2: 新 Buff 入库（buff.xlsx）

**Files:**
- Modify: `tools/seed-buff-xlsx.ts`（BUFFS_ROWS 加 4 行）
- 产物: `tools/config-xlsx/buff.xlsx`、`assets/scripts/config/buff.config.generated.ts`

**Interfaces:**
- Produces: buff id `ct_bulwark` / `ct_shadow` / `ct_inspire` / `ct_po_jun`——Task 3 导表器跨表校验 `applyBuff` 引用时必须已存在。

- [ ] **Step 1: seed-buff-xlsx.ts 的 BUFFS_ROWS 末尾追加**

```ts
    // duration=-1 永久：角色天赋被动承载体，层数=天赋级数（2026-07-12 chartalent）
    ['ct_bulwark', '坚韧', -1, 5, 'add', 0, '', 'dmgReduce:+0.01', '', ''],
    ['ct_shadow',  '残影', -1, 5, 'add', 0, '', 'dodgeRate:+0.01', '', ''],
    ['ct_inspire', '鼓舞', -1, 5, 'add', 0, '', 'atk%:0.01',       '', ''],
    ['ct_po_jun',  '破军', 6,  5, 'add', 0, '', 'dmgBonus:+0.05',  '', ''],
```

- [ ] **Step 2: 重建 xlsx 并导表**

Run: `npm run seed:buff && npm run config`
Expected: seed 输出 `sheets: Buffs(12)`；config 输出各源 `✓`（buff summary 含 12 个 buff），无 err。

- [ ] **Step 3: 回归 Buff 单测**

Run: `npm run test:buff && npm run test:passive`
Expected: 全 ✓（新增行不影响既有 buff 行为）。

- [ ] **Step 4: 暂存**

```bash
git add tools/seed-buff-xlsx.ts tools/config-xlsx/buff.xlsx assets/scripts/config/buff.config.generated.ts
```

---

### Task 3: 导表器 buildCharTalentConfig

**Files:**
- Modify: `tools/excel-to-config.ts`（buildTalentConfig 之后加解析器；SOURCES 末尾加条目）
- 产物: `assets/scripts/config/chartalent.config.generated.ts`

**Interfaces:**
- Consumes: `knownBuffIds`（buff 源先解析，模块级变量，同 buildSkillConfig 用法）、`EQUIP_STAT_KEY_SET`、`parseEffectList`。
- Produces: `generatedCharTalentConfig = { nodes: [...], passives: [{ nodeId, level, def: PassiveDef }] }`，Task 4 的 `CharTalentConfig` 按此形状断言。

- [ ] **Step 1: 在 buildTalentConfig 之后加解析器**

```ts
// ============ chartalent 模块解析器 ============
// 读 chartalent.xlsx 的 2 sheet → 角色天赋树（职业专属、等级门槛分层、无连线）。
// Nodes: cls,id,label,tier,levelReq,maxLevel,kind,statKey,valuePerLevel
// Passives: nodeId,level,name,trigger,chance,targetMode,effects（被动节点每级一条完整 PassiveDef）
function buildCharTalentConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_CLASSES = new Set(['tank', 'dps', 'healer']);
    const VALID_KINDS = new Set(['stat', 'passive']);
    const VALID_PASSIVE_TRIGGERS = new Set(['always', 'onHit', 'onHurt', 'onKill', 'onCast']);
    const VALID_TARGET_MODES = new Set(['trigger', 'self', 'team']);

    const { rows } = sheetToRows(wb, 'Nodes');
    interface RawNode {
        id: string; label: string; cls: string; tier: number; levelReq: number;
        maxLevel: number; kind: string; statKey: string; valuePerLevel: number;
    }
    const nodes: RawNode[] = [];
    const ids = new Set<string>();
    for (const r of rows) {
        const id = reqStr(r['id'], 'Nodes.id');
        if (ids.has(id)) err(`Nodes: id "${id}" 重复定义`);
        ids.add(id);
        const cls = reqStr(r['cls'], `Nodes[${id}].cls`);
        if (!VALID_CLASSES.has(cls)) err(`Nodes[${id}].cls "${cls}" 非法（tank/dps/healer）`);
        const tier = reqNum(r['tier'], `Nodes[${id}].tier`);
        if (tier < 1) err(`Nodes[${id}].tier 必须 >= 1`);
        const levelReq = reqNum(r['levelReq'], `Nodes[${id}].levelReq`);
        if (levelReq < 1 || levelReq > 100) err(`Nodes[${id}].levelReq 必须在 [1,100]`);
        const maxLevel = reqNum(r['maxLevel'], `Nodes[${id}].maxLevel`);
        if (maxLevel < 1) err(`Nodes[${id}].maxLevel 必须 >= 1`);
        const kind = reqStr(r['kind'], `Nodes[${id}].kind`);
        if (!VALID_KINDS.has(kind)) err(`Nodes[${id}].kind "${kind}" 非法（stat/passive）`);
        const statKey = String(r['statKey'] ?? '').trim();
        const valuePerLevel = Number(r['valuePerLevel'] ?? 0);
        if (kind === 'stat') {
            if (!EQUIP_STAT_KEY_SET.has(statKey)) err(`Nodes[${id}].statKey "${statKey}" 不是合法装备属性键`);
            if (!(valuePerLevel > 0)) err(`Nodes[${id}].valuePerLevel 必须 > 0`);
        } else if (statKey !== '' || valuePerLevel !== 0) {
            err(`Nodes[${id}]: passive 节点的 statKey/valuePerLevel 必须为空`);
        }
        nodes.push({ id, label: reqStr(r['label'], `Nodes[${id}].label`), cls, tier, levelReq, maxLevel, kind, statKey, valuePerLevel });
    }
    if (nodes.length === 0) err('Nodes: 至少需要 1 个节点');

    // Passives：被动节点 1..maxLevel 每级恰好一条；stat 节点不得有行
    const byId = new Map(nodes.map(n => [n.id, n]));
    const { rows: pRows } = sheetToRows(wb, 'Passives');
    const passives: unknown[] = [];
    const seenLv = new Set<string>();
    for (const r of pRows) {
        const nodeId = reqStr(r['nodeId'], 'Passives.nodeId');
        const node = byId.get(nodeId);
        if (!node) { err(`Passives: nodeId "${nodeId}" 不存在于 Nodes`); continue; }
        if (node.kind !== 'passive') err(`Passives[${nodeId}]: 对应节点 kind 不是 passive`);
        const level = reqNum(r['level'], `Passives[${nodeId}].level`);
        if (level < 1 || level > node.maxLevel) err(`Passives[${nodeId}].level ${level} 超出 [1,${node.maxLevel}]`);
        const key = `${nodeId}|${level}`;
        if (seenLv.has(key)) err(`Passives: ${nodeId} 第 ${level} 级重复定义`);
        seenLv.add(key);
        const trigger = reqStr(r['trigger'], `Passives[${nodeId}].trigger`);
        if (!VALID_PASSIVE_TRIGGERS.has(trigger)) err(`Passives[${nodeId}].trigger "${trigger}" 非法（always/onHit/onHurt/onKill/onCast）`);
        const chance = reqNum(r['chance'], `Passives[${nodeId}].chance`);
        if (chance < 0 || chance > 1) err(`Passives[${nodeId}].chance 必须在 [0,1]`);
        if (trigger === 'always' && chance !== 1) err(`Passives[${nodeId}]: always 被动的 chance 必须为 1`);
        const targetMode = reqStr(r['targetMode'], `Passives[${nodeId}].targetMode`);
        if (!VALID_TARGET_MODES.has(targetMode)) err(`Passives[${nodeId}].targetMode "${targetMode}" 非法（trigger/self/team）`);
        if (trigger === 'onKill' && targetMode === 'trigger') err(`Passives[${nodeId}]: onKill 被动不可用 targetMode=trigger（被杀者已死）`);
        const effects = parseEffectList(String(r['effects'] ?? ''), m => err(`Passives[${nodeId}].effects: ${m}`));
        if (effects.length === 0) err(`Passives[${nodeId}].effects 至少需要一个效果`);
        for (const eff of effects) {
            if (eff.kind === 'applyBuff' && !knownBuffIds.has(eff.buffId)) {
                err(`Passives[${nodeId}].effects: applyBuff 引用了不存在的 buff "${eff.buffId}"（见 buff.xlsx）`);
            }
            if (eff.kind === 'damage' && eff.mult <= 0) err(`Passives[${nodeId}].effects: damage 倍率必须 > 0`);
        }
        const name = reqStr(r['name'], `Passives[${nodeId}].name`);
        passives.push({ nodeId, level, def: { id: `${nodeId}_l${level}`, name, cls: node.cls, trigger, chance, targetMode, effects } });
    }
    for (const n of nodes) {
        if (n.kind !== 'passive') continue;
        for (let lv = 1; lv <= n.maxLevel; lv++) {
            if (!seenLv.has(`${n.id}|${lv}`)) err(`Passives: 被动节点 ${n.id} 缺第 ${lv} 级定义`);
        }
    }

    const config = { nodes, passives };
    const summary = `nodes=${nodes.length} passiveRows=${passives.length}`;
    return { config, summary };
}
```

- [ ] **Step 2: SOURCES 末尾（talent 条目之后）加**

```ts
    {
        name: 'chartalent',
        xlsxRel: 'config-xlsx/chartalent.xlsx',
        outRel: '../assets/scripts/config/chartalent.config.generated.ts',
        exportVar: 'generatedCharTalentConfig',
        build: buildCharTalentConfig,
    },
```

- [ ] **Step 3: 导表验证**

Run: `npm run config`
Expected: 末行含 `chartalent ... nodes=39 passiveRows=60`，无 err；产物 `assets/scripts/config/chartalent.config.generated.ts` 生成。

- [ ] **Step 4: 暂存**

```bash
git add tools/excel-to-config.ts assets/scripts/config/chartalent.config.generated.ts
```

---

### Task 4: CharTalentConfig 纯查询层 + 单测骨架

**Files:**
- Create: `assets/scripts/chartalent/CharTalentConfig.ts`
- Create: `tools/chartalent-test.ts`
- Modify: `package.json`（`test:chartalent` 脚本 + `test` 链末尾追加）

**Interfaces:**
- Produces: `charTalentNodes(cls): CharTalentNodeDef[]`、`charTalentNodeById(id)`、`charTalentPassiveAt(nodeId, level): PassiveDef | undefined`、`charTalentTreeCapacity(cls): number`。Task 5/6/9 消费。

- [ ] **Step 1: 写失败测试（tools/chartalent-test.ts）**

```ts
// 角色天赋（chartalent）纯逻辑单测（tsx 运行）：Config 查询 + Model 投点/洗点/自愈 + Stats 聚合 + 战斗注入。
import * as assert from 'node:assert/strict';
import { charTalentNodes, charTalentNodeById, charTalentPassiveAt, charTalentTreeCapacity } from '../assets/scripts/chartalent/CharTalentConfig';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('配置载入：三职业各 13 节点、容量 128', () => {
    for (const cls of ['tank', 'dps', 'healer']) {
        assert.equal(charTalentNodes(cls).length, 13);
        assert.equal(charTalentTreeCapacity(cls), 128);
    }
    assert.equal(charTalentNodeById('ct_tank_hp')!.levelReq, 1);
    assert.equal(charTalentNodeById('ct_dps_shadow')!.levelReq, 70);
});

test('被动查询：每级一条、id 带级别后缀、越级 undefined', () => {
    const l3 = charTalentPassiveAt('ct_tank_thorns', 3)!;
    assert.equal(l3.id, 'ct_tank_thorns_l3');
    assert.equal(l3.trigger, 'onHurt');
    assert.equal(charTalentPassiveAt('ct_tank_thorns', 6), undefined);
    assert.equal(charTalentPassiveAt('ct_tank_hp', 1), undefined);   // stat 节点无被动
});

console.log(`\nchartalent: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
```

package.json：`"test:chartalent": "tsx tools/chartalent-test.ts"`；`test` 链末尾追加 `&& npm run test:chartalent`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:chartalent`
Expected: FAIL（模块不存在，import 报错）。

- [ ] **Step 3: 写实现**

```ts
// assets/scripts/chartalent/CharTalentConfig.ts
// 角色天赋树配置纯查询层（不依赖 cc）。与账号级心法（talent/）无关。
// ★★★ 数值由 Excel 管理 ★★★ 源文件：tools/config-xlsx/chartalent.xlsx → npm run config

import { generatedCharTalentConfig } from '../config/chartalent.config.generated';
import type { PassiveDef } from '../config/SkillConfig';

export type CharTalentKind = 'stat' | 'passive';

export interface CharTalentNodeDef {
    id: string;
    label: string;
    cls: string;           // SoldierClass；导表已校验合法性
    tier: number;          // 等级门槛分层的行号（UI 排布用）
    levelReq: number;      // 角色等级门槛（唯一前置条件，无节点连线）
    maxLevel: number;      // 全部可多级，每级 1 技能点
    kind: CharTalentKind;
    statKey: string;       // kind=stat 时为 EquipStatKey；passive 为空
    valuePerLevel: number; // kind=stat 每级加值；passive 为 0
}

export interface CharTalentPassiveRow { nodeId: string; level: number; def: PassiveDef; }
export interface CharTalentConfigShape { nodes: CharTalentNodeDef[]; passives: CharTalentPassiveRow[]; }

export const CharTalentConfig = generatedCharTalentConfig as CharTalentConfigShape;

let _byId: Map<string, CharTalentNodeDef> | null = null;
let _byCls: Map<string, CharTalentNodeDef[]> | null = null;
let _passiveByKey: Map<string, PassiveDef> | null = null;

export function charTalentNodes(cls: string): CharTalentNodeDef[] {
    if (!_byCls) {
        _byCls = new Map();
        for (const n of CharTalentConfig.nodes) {
            const list = _byCls.get(n.cls) ?? [];
            list.push(n);
            _byCls.set(n.cls, list);
        }
    }
    return _byCls.get(cls) ?? [];
}

export function charTalentNodeById(id: string): CharTalentNodeDef | undefined {
    if (!_byId) {
        _byId = new Map();
        for (const n of CharTalentConfig.nodes) _byId.set(n.id, n);
    }
    return _byId.get(id);
}

// 被动节点第 level 级的 PassiveDef；stat 节点/越级返回 undefined
export function charTalentPassiveAt(nodeId: string, level: number): PassiveDef | undefined {
    if (!_passiveByKey) {
        _passiveByKey = new Map();
        for (const p of CharTalentConfig.passives) _passiveByKey.set(`${p.nodeId}|${p.level}`, p.def);
    }
    return _passiveByKey.get(`${nodeId}|${level}`);
}

// 整树点满所需技能点（= 全节点 maxLevel 之和；UI 展示与测试用）
export function charTalentTreeCapacity(cls: string): number {
    let sum = 0;
    for (const n of charTalentNodes(cls)) sum += n.maxLevel;
    return sum;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:chartalent`
Expected: 2 通过, 0 失败。

- [ ] **Step 5: 暂存**

```bash
git add assets/scripts/chartalent/CharTalentConfig.ts tools/chartalent-test.ts package.json
```

---

### Task 5: CharTalentModel 投点/洗点/存档自愈

**Files:**
- Create: `assets/scripts/chartalent/CharTalentModel.ts`
- Modify: `tools/chartalent-test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 4 的 `charTalentNodeById`、`charTalentNodes`。
- Produces: `CharTalentSave = Record<string, Record<string, number>>`（cls → nodeId → 级数）、`nodeLevelOf(save, cls, nodeId)`、`spentPoints(save, cls)`、`availablePoints(save, cls, charLevel)`、`learnNode(save, cls, nodeId, charLevel): CharTalentLearnResult`、`resetChar(save, cls)`、`sanitizeCharTalents(raw, levelOf): CharTalentSave`。Task 6/8/9 消费。

- [ ] **Step 1: 追加失败测试（chartalent-test.ts import 区加 Model 导入，末尾 console 前追加）**

```ts
import { nodeLevelOf, spentPoints, availablePoints, learnNode, resetChar, sanitizeCharTalents, type CharTalentSave } from '../assets/scripts/chartalent/CharTalentModel';

test('availablePoints：点数 = 等级-1 - 已投；Lv.1 为 0', () => {
    const save: CharTalentSave = {};
    assert.equal(availablePoints(save, 'tank', 1), 0);
    assert.equal(availablePoints(save, 'tank', 100), 99);
    save['tank'] = { ct_tank_hp: 3, ct_tank_def: 2 };
    assert.equal(spentPoints(save, 'tank'), 5);
    assert.equal(availablePoints(save, 'tank', 10), 4);
});

test('learnNode：达门槛有点数 → 升 1 级', () => {
    const save: CharTalentSave = {};
    const r = learnNode(save, 'tank', 'ct_tank_hp', 2);   // Lv.2 → 1 点
    assert.ok(r.ok);
    assert.equal(r.newLevel, 1);
    assert.equal(nodeLevelOf(save, 'tank', 'ct_tank_hp'), 1);
    assert.equal(availablePoints(save, 'tank', 2), 0);
});

test('learnNode：等级未达门槛 → 拒绝', () => {
    const save: CharTalentSave = {};
    const r = learnNode(save, 'tank', 'ct_tank_thorns', 9);   // 反震需 Lv.10
    assert.equal(r.ok, false);
    assert.equal(nodeLevelOf(save, 'tank', 'ct_tank_thorns'), 0);
});

test('learnNode：无剩余点数 → 拒绝', () => {
    const save: CharTalentSave = { tank: { ct_tank_hp: 1 } };
    const r = learnNode(save, 'tank', 'ct_tank_def', 2);   // 1 点已花光
    assert.equal(r.ok, false);
});

test('learnNode：点满 / 未知节点 / 职业不匹配 → 拒绝', () => {
    const save: CharTalentSave = { tank: { ct_tank_thorns: 5 } };
    assert.equal(learnNode(save, 'tank', 'ct_tank_thorns', 100).ok, false);   // 已满 5 级
    assert.equal(learnNode(save, 'tank', 'no_such_node', 100).ok, false);
    assert.equal(learnNode(save, 'tank', 'ct_dps_atk', 100).ok, false);       // dps 节点点不进 tank
});

test('resetChar：清空投点、点数回满、其他职业不受影响', () => {
    const save: CharTalentSave = { tank: { ct_tank_hp: 3 }, dps: { ct_dps_atk: 2 } };
    resetChar(save, 'tank');
    assert.equal(spentPoints(save, 'tank'), 0);
    assert.equal(availablePoints(save, 'tank', 10), 9);
    assert.equal(nodeLevelOf(save, 'dps', 'ct_dps_atk'), 2);
});

test('sanitize：未知节点丢弃、级数钳制、负值归零', () => {
    const raw = { tank: { ct_tank_hp: 99, ghost: 3, ct_tank_def: -2 }, junk: 5 };
    const save = sanitizeCharTalents(raw, () => 100);
    assert.equal(nodeLevelOf(save, 'tank', 'ct_tank_hp'), 12);   // 钳到 maxLevel
    assert.equal(nodeLevelOf(save, 'tank', 'ghost'), 0);
    assert.equal(nodeLevelOf(save, 'tank', 'ct_tank_def'), 0);
});

test('sanitize：投点总数超发 → 按配置顺序截断到预算', () => {
    const raw = { tank: { ct_tank_hp: 5, ct_tank_def: 5 } };
    const save = sanitizeCharTalents(raw, () => 8);   // Lv.8 预算 7 点
    assert.equal(spentPoints(save, 'tank'), 7);
    assert.equal(nodeLevelOf(save, 'tank', 'ct_tank_hp'), 5);   // 配置序在前，保留全额
    assert.equal(nodeLevelOf(save, 'tank', 'ct_tank_def'), 2);  // 截断
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:chartalent`
Expected: FAIL（CharTalentModel 不存在）。

- [ ] **Step 3: 写实现**

```ts
// assets/scripts/chartalent/CharTalentModel.ts
// 角色天赋投点纯逻辑（不依赖 cc）：learnNode 四步校验 fail-before-mutate（镜像 TalentModel）。
// 技能点不存档，派生：可用点数 = (角色等级 - 1) - 已投总点数；洗点 = 清空该职业投点记录。
// 存档形状 CharTalentSave 挂 PlayerData.charTalents；读档经 sanitizeCharTalents 自愈。

import { charTalentNodeById, charTalentNodes } from './CharTalentConfig';

export type CharTalentSave = Record<string, Record<string, number>>;

export interface CharTalentLearnResult {
    ok: boolean;
    reason?: string;
    newLevel?: number;
}
function failResult(reason: string): CharTalentLearnResult { return { ok: false, reason }; }

export function nodeLevelOf(save: CharTalentSave | undefined, cls: string, nodeId: string): number {
    const v = save?.[cls]?.[nodeId];
    return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
}

// 已投总点数：只统计该职业配置里存在的节点，级数按 maxLevel 截断（脏档不虚增）
export function spentPoints(save: CharTalentSave | undefined, cls: string): number {
    let sum = 0;
    for (const n of charTalentNodes(cls)) sum += Math.min(nodeLevelOf(save, cls, n.id), n.maxLevel);
    return sum;
}

export function availablePoints(save: CharTalentSave | undefined, cls: string, charLevel: number): number {
    return Math.max(0, Math.floor(charLevel) - 1 - spentPoints(save, cls));
}

// 投 1 点：节点存在且属本职业 → 未满 → 角色等级达门槛 → 有剩余点数；失败不改档
export function learnNode(save: CharTalentSave, cls: string, nodeId: string, charLevel: number): CharTalentLearnResult {
    const node = charTalentNodeById(nodeId);
    if (!node || node.cls !== cls) return failResult('天赋节点不存在');
    const cur = nodeLevelOf(save, cls, nodeId);
    if (cur >= node.maxLevel) return failResult('该天赋已点满');
    if (charLevel < node.levelReq) return failResult(`需角色 Lv.${node.levelReq}`);
    if (availablePoints(save, cls, charLevel) < 1) return failResult('技能点不足');
    (save[cls] ??= {})[nodeId] = cur + 1;
    return { ok: true, newLevel: cur + 1 };
}

// 免费洗点：清空该职业全部投点（点数余额随 availablePoints 自动回满）
export function resetChar(save: CharTalentSave, cls: string): void {
    delete save[cls];
}

// 存档自愈：未知职业键/未知节点丢弃、级数取整钳制 [0, maxLevel]、
// 投点总数超预算（等级-1）时按配置顺序保留、越界截断（防脏档凭空多点）。
export function sanitizeCharTalents(raw: unknown, levelOf: (cls: string) => number): CharTalentSave {
    const out: CharTalentSave = {};
    if (!raw || typeof raw !== 'object') return out;
    const src = raw as Record<string, unknown>;
    const classes = new Set<string>();
    for (const n of charTalentNodes('tank')) classes.add(n.cls);
    for (const cls of ['tank', 'dps', 'healer']) {
        const entry = src[cls];
        if (!entry || typeof entry !== 'object') continue;
        const levels = entry as Record<string, unknown>;
        let budget = Math.max(0, Math.floor(levelOf(cls)) - 1);
        const clean: Record<string, number> = {};
        for (const node of charTalentNodes(cls)) {
            const v = levels[node.id];
            if (typeof v !== 'number' || v <= 0) continue;
            const lv = Math.min(Math.floor(v), node.maxLevel, budget);
            if (lv <= 0) continue;
            clean[node.id] = lv;
            budget -= lv;
        }
        if (Object.keys(clean).length > 0) out[cls] = clean;
    }
    return out;
}
```

注意：实现后删掉 `classes` 变量若未使用（上面代码里它是冗余的，直接写死三职业循环即可——以最终 lint/typecheck 干净为准）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:chartalent`
Expected: 10 通过, 0 失败。

- [ ] **Step 5: 暂存**

```bash
git add assets/scripts/chartalent/CharTalentModel.ts tools/chartalent-test.ts
```

---

### Task 6: CharTalentStats 聚合（属性 + 当前级被动）

**Files:**
- Create: `assets/scripts/chartalent/CharTalentStats.ts`
- Modify: `tools/chartalent-test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 4/5 全部导出。
- Produces: `CharTalentAggregate { stats: EquipStats; passives: PassiveDef[] }`、`charTalentAggregate(save, cls)`、`emptyCharTalentAggregate()`。Task 7/8 消费。

- [ ] **Step 1: 追加失败测试**

```ts
import { charTalentAggregate, emptyCharTalentAggregate } from '../assets/scripts/chartalent/CharTalentStats';

test('aggregate：stat 节点按级数求和、未投为空', () => {
    assert.deepEqual(charTalentAggregate({}, 'tank'), emptyCharTalentAggregate());
    const save: CharTalentSave = { tank: { ct_tank_hp: 3, ct_tank_hpflat: 2 } };
    const agg = charTalentAggregate(save, 'tank');
    assert.ok(Math.abs((agg.stats.hpPct ?? 0) - 0.03) < 1e-9);
    assert.equal(agg.stats.hp, 60);
    assert.equal(agg.passives.length, 0);
});

test('aggregate：passive 节点只取当前级那条 def', () => {
    const save: CharTalentSave = { dps: { ct_dps_combo: 3, ct_dps_shadow: 1 } };
    const agg = charTalentAggregate(save, 'dps');
    assert.equal(agg.passives.length, 2);
    const ids = agg.passives.map(p => p.id).sort();
    assert.deepEqual(ids, ['ct_dps_combo_l3', 'ct_dps_shadow_l1']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:chartalent` → FAIL（CharTalentStats 不存在）。

- [ ] **Step 3: 写实现**

```ts
// assets/scripts/chartalent/CharTalentStats.ts
// 角色天赋聚合纯函数（不依赖 cc）：把某职业的投点档汇总成 属性加成 + 已学被动列表。
// stats → EffectiveStats 的 perClassStats（只作用本角色）；passives → 开战追加进单位 passives。
// 被动只取当前级那条 PassiveDef（级间参数递进，非逐级叠加）。

import type { EquipStats, EquipStatKey } from '../inventory/EquipDefs';
import type { PassiveDef } from '../config/SkillConfig';
import { charTalentNodes, charTalentPassiveAt } from './CharTalentConfig';
import { nodeLevelOf, type CharTalentSave } from './CharTalentModel';

export interface CharTalentAggregate {
    stats: EquipStats;
    passives: PassiveDef[];
}

export function emptyCharTalentAggregate(): CharTalentAggregate {
    return { stats: {}, passives: [] };
}

export function charTalentAggregate(save: CharTalentSave | undefined, cls: string): CharTalentAggregate {
    const out = emptyCharTalentAggregate();
    if (!save) return out;
    for (const node of charTalentNodes(cls)) {
        const lv = Math.min(nodeLevelOf(save, cls, node.id), node.maxLevel);
        if (lv <= 0) continue;
        if (node.kind === 'stat') {
            const k = node.statKey as EquipStatKey;
            out.stats[k] = (out.stats[k] ?? 0) + node.valuePerLevel * lv;
        } else {
            const def = charTalentPassiveAt(node.id, lv);
            if (def) out.passives.push(def);
        }
    }
    return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:chartalent` → 12 通过, 0 失败。

- [ ] **Step 5: 暂存**

```bash
git add assets/scripts/chartalent/CharTalentStats.ts tools/chartalent-test.ts
```

---

### Task 7: 战斗注入地基（EffectiveStats perClassStats + BattleManager extraPassives + PlayerData 字段）

**Files:**
- Modify: `assets/scripts/combat/EffectiveStats.ts`（buildEffectiveStatsMap 加第 4 参）
- Modify: `assets/scripts/combat/BattleManager.ts`（构造器加第 6 参；_setupSquad 追加被动）
- Modify: `assets/scripts/core/data/DataService.ts`（PlayerData 加 `charTalents?`）
- Modify: `tools/chartalent-test.ts`（追加注入用例）

**Interfaces:**
- Consumes: Task 6 的 `CharTalentAggregate`。
- Produces: `buildEffectiveStatsMap(equipped, levels?, extraStats?, perClassStats?: Partial<Record<SoldierClass, EquipStats>>)`；`new BattleManager(halfW, halfH, levelIndex?, effectiveStats?, roster?, extraPassives?: Partial<Record<SoldierClass, PassiveDef[]>>)`；`PlayerData.charTalents?: CharTalentSave`。Task 8 消费。全部可选参，既有调用点（16 处 tools + BattleEntry）零改动。

- [ ] **Step 1: 追加失败测试**

```ts
import { buildEffectiveStatsMap } from '../assets/scripts/combat/EffectiveStats';
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { BattleConfig } from '../assets/scripts/config/BattleConfig';

test('EffectiveStats：perClassStats 只作用对应职业、与全局 extraStats 叠加', () => {
    const base = buildEffectiveStatsMap(undefined, {});
    const map = buildEffectiveStatsMap(undefined, {}, { atk: 10 }, { tank: { hp: 100 } });
    assert.equal(map.tank!.hp, base.tank!.hp + 100);
    assert.equal(map.tank!.atk, base.tank!.atk + 10);
    assert.equal(map.dps!.hp, base.dps!.hp);          // perClass 不外溢
    assert.equal(map.dps!.atk, base.dps!.atk + 10);   // 全局仍生效
});

test('BattleManager：extraPassives 追加到对应士兵、always 被动开战即上永久 Buff', () => {
    const alwaysDef = {
        id: 'ct_tank_bulwark_l3', name: '坚韧', cls: 'tank',
        trigger: 'always' as const, chance: 1, targetMode: 'self' as const,
        effects: [{ kind: 'applyBuff' as const, buffId: 'ct_bulwark', stacks: 3 }],
    };
    const mgr = new BattleManager(470, 836, 0, {}, ['tank', 'dps'], { tank: [alwaysDef] });
    const tank = mgr.soldiers.find(s => s.cls === 'tank')!;
    const dps = mgr.soldiers.find(s => s.cls === 'dps')!;
    assert.ok(tank.passives.some(p => p.id === 'ct_tank_bulwark_l3'));
    assert.ok(!dps.passives.some(p => p.id === 'ct_tank_bulwark_l3'));
    const buff = tank.buffs.find(b => b.id === 'ct_bulwark');
    assert.ok(buff && buff.stacks === 3);
    assert.ok(tank.stats.dmgReduce > BattleConfig.stats.tank.dmgReduce);   // 3 层 ×0.01 生效
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:chartalent` → FAIL（buildEffectiveStatsMap 第 4 参不存在 / BattleManager 第 6 参不存在）。

- [ ] **Step 3: EffectiveStats.ts 改动**

`buildEffectiveStatsMap` 签名与循环体改为：

```ts
// 全局与按职业加成合并（键求和）；都缺省时返回 undefined 走旧路径
function mergeExtraStats(a?: EquipStats, b?: EquipStats): EquipStats | undefined {
    if (!a) return b;
    if (!b) return a;
    const out: EquipStats = { ...a };
    for (const k of Object.keys(b) as (keyof EquipStats)[]) out[k] = (out[k] ?? 0) + (b[k] ?? 0);
    return out;
}

// levels 缺省/角色缺项 = 不做等级缩放（向后兼容，pacing-sim 不传即纯装备档位）。
// extraStats：心法等全局加成（全队同值）；perClassStats：角色天赋等按职业加成（只作用本角色）。
export function buildEffectiveStatsMap(
    equipped: CharEquipped | undefined,
    levels: Partial<Record<SoldierClass, number>> = {},
    extraStats?: EquipStats,
    perClassStats?: Partial<Record<SoldierClass, EquipStats>>,
): EffectiveStatsMap {
    const map: EffectiveStatsMap = {};
    for (const c of CHARACTERS) {
        const cls = c as SoldierClass;
        const base = BattleConfig.stats[cls];
        if (!base) continue;
        const level = levels[cls];
        const slots = equipped?.[c];
        const merged = mergeExtraStats(extraStats, perClassStats?.[cls]);
        // 等级 = 三围百分比乘全池（旧行为只放大白板 hp/atk；2026-07-11 双层公式改此，含 def）
        map[cls] = calcEffectiveStats(base, slots ? SLOTS.map(s => slots[s]) : [], level ? charLevelCoef(level) - 1 : 0, merged);
    }
    return map;
}
```

- [ ] **Step 4: BattleManager.ts 改动**

导入区加：`import type { PassiveDef } from '../config/SkillConfig';`
字段区（`private _roster` 旁）加：`private _extraPassives: Partial<Record<SoldierClass, PassiveDef[]>>;`
构造器：

```ts
constructor(halfW: number, halfH: number, levelIndex = BattleConfig.startLevel, effectiveStats: EffectiveStatsMap = {}, roster: SoldierClass[] = BattleConfig.roster, extraPassives: Partial<Record<SoldierClass, PassiveDef[]>> = {}) {
    this.halfW = halfW;
    this.halfH = halfH;
    this.effectiveStats = effectiveStats;
    this._roster = roster;
    this._extraPassives = extraPassives;
    this.levelIndex = Math.max(0, Math.min(levelIndex, BattleConfig.levels.length - 1));
    this._setupSquad();
    this._startWave(0);
}
```

`_setupSquad` 建兵循环改为（追加天赋被动，须在后面的 applyAlwaysPassives 之前完成）：

```ts
this._roster.forEach((cls, i) => {
    const st = this.effectiveStats[cls] ?? BattleConfig.stats[cls]; // 职业战斗属性（统一表）
    const hx = frontX - i * L.spacing;   // 越靠后（i 越大）越靠左
    const unit = createSoldierUnit(this._unitSeq++, cls, st, hx, 0);
    const extra = this._extraPassives[cls];   // 角色天赋已学被动（每节点取当前级一条）
    if (extra && extra.length > 0) unit.passives = [...unit.passives, ...extra];
    this.soldiers.push(unit);
});
```

- [ ] **Step 5: DataService.ts 改动**

导入区加：`import type { CharTalentSave } from '../../chartalent/CharTalentModel';`
`PlayerData` 接口 `talents?` 行后加：

```ts
    charTalents?: CharTalentSave;  // 角色天赋（每职业投点档）；老存档缺它 = 一点未点
```

- [ ] **Step 6: 跑测试与回归**

Run: `npm run test:chartalent && npm run test:effective && npm run test:combat && npm run test:passive`
Expected: 全 ✓（新参数缺省 = 旧行为）。

- [ ] **Step 7: 暂存**

```bash
git add assets/scripts/combat/EffectiveStats.ts assets/scripts/combat/BattleManager.ts assets/scripts/core/data/DataService.ts tools/chartalent-test.ts
```

---

### Task 8: BattleEntry 组合根接线

**Files:**
- Modify: `assets/scripts/BattleEntry.ts`

**Interfaces:**
- Consumes: Task 5/6/7 全部导出。
- Produces: `_charTalents: CharTalentSave` 缓存、`_refreshCharTalentCache()`、`_persistCharTalents()`、`_charTalentInjection(): { perClassStats, extraPassives }`。Task 9 的面板回调消费 `_charTalents`/`_persistCharTalents`。

- [ ] **Step 1: 导入与字段**

导入区加：

```ts
import { sanitizeCharTalents, type CharTalentSave } from './chartalent/CharTalentModel';
import { charTalentAggregate } from './chartalent/CharTalentStats';
import type { PassiveDef } from './config/SkillConfig';
import type { EquipStats } from './inventory/EquipDefs';
```

字段区（`_talentAgg` 旁）加：

```ts
    private _charTalents: CharTalentSave = {};
```

- [ ] **Step 2: 读档链挂载**

`_loadAllPlayerData` 中 `loadGrowth` 之后（自愈需要角色等级）插入：

```ts
            .then(() => loadGrowth())
            .then((growth) => { this._growth = growth; })
            .then(() => this._refreshCharTalentCache())
```

方法区（`_persistTalents` 之后）加：

```ts
    // 角色天赋缓存：读档 + 自愈（未知节点丢弃/级数钳制/超发按配置序截断）。须在 loadGrowth 之后跑。
    private async _refreshCharTalentCache(): Promise<void> {
        const data = await loadPlayerData();
        this._charTalents = sanitizeCharTalents(data.charTalents, (cls) => this._growth?.levelOf(cls as SoldierClass) ?? 1);
    }

    // 投点/洗点后落盘：面板经 CharTalentModel 就地改 _charTalents，这里整体深拷贝写档
    private async _persistCharTalents(): Promise<void> {
        const data = await loadPlayerData();
        const copy: CharTalentSave = {};
        for (const cls of Object.keys(this._charTalents)) copy[cls] = { ...this._charTalents[cls] };
        data.charTalents = copy;
        await savePlayerData();
    }

    // 开战/面板注入值：每职业聚合一次（属性 → perClassStats；被动 → extraPassives）
    private _charTalentInjection(): { perClassStats: Partial<Record<SoldierClass, EquipStats>>; extraPassives: Partial<Record<SoldierClass, PassiveDef[]>> } {
        const perClassStats: Partial<Record<SoldierClass, EquipStats>> = {};
        const extraPassives: Partial<Record<SoldierClass, PassiveDef[]>> = {};
        for (const c of CHARACTERS) {
            const agg = charTalentAggregate(this._charTalents, c);
            if (Object.keys(agg.stats).length > 0) perClassStats[c as SoldierClass] = agg.stats;
            if (agg.passives.length > 0) extraPassives[c as SoldierClass] = agg.passives;
        }
        return { perClassStats, extraPassives };
    }
```

- [ ] **Step 3: 开战注入**

`_startBattle` 中改：

```ts
        const talentInj = this._charTalentInjection();
        const effective = this._inv
            ? buildEffectiveStatsMap(this._inv.equipped, levels, this._talentAgg.stats, talentInj.perClassStats)
            : buildEffectiveStatsMap(undefined, levels, this._talentAgg.stats, talentInj.perClassStats);
        ...
        this._mgr = new BattleManager(this._halfW, this._halfH, levelIndex, effective, roster, talentInj.extraPassives);
```

- [ ] **Step 4: 主界面战力同步**

`_mainUiData` 中改：

```ts
        const effective = buildEffectiveStatsMap(this._inv?.equipped, levels, this._talentAgg.stats, this._charTalentInjection().perClassStats);
```

- [ ] **Step 5: 编译验证**

Run: `npm run typecheck`
Expected: 双环境 0 error。（面板还没建，本任务只接数据流。）

- [ ] **Step 6: 暂存**

```bash
git add assets/scripts/BattleEntry.ts
```

---

### Task 9: CharTalentPanel 面板 + 三处入口

**Files:**
- Create: `assets/scripts/ui/panels/CharTalentPanel.ts`
- Modify: `assets/scripts/ui/MainScreenView.ts`（options 加 `onCharTalent`；AvatarHot 热区）
- Modify: `assets/scripts/ui/BattleStageView.ts`（options 透传 `onCharTalent`）
- Modify: `assets/scripts/ui/panels/SquadPanel.ts`（options 加 `onCharTalent`；每行「天赋」按钮）
- Modify: `assets/scripts/BattleEntry.ts`（实例化面板、接回调）

**Interfaces:**
- Consumes: Task 4/5/8 导出；`CharacterGrowthModel.levelOf(cls)`；`CHARACTER_LABEL`（EquipDefs）。
- Produces: `CharTalentPanel { isOpen(); toggle(); show(cls?); hide(); destroy(); }`。

- [ ] **Step 1: 写面板（对齐 TalentPanel 的 Graphics+Label+hots 实现风格）**

```ts
// assets/scripts/ui/panels/CharTalentPanel.ts
// 角色天赋覆盖层：职业页签 + 等级门槛分层网格 + 免费洗点（两击确认）。
// 无节点连线（唯一前置=角色等级）；点可投节点直接投 1 点；持久化由回调注入（组合根 BattleEntry）。

import { Color, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { charTalentNodes, charTalentPassiveAt, type CharTalentNodeDef } from '../../chartalent/CharTalentConfig';
import { availablePoints, learnNode, nodeLevelOf, resetChar, type CharTalentSave } from '../../chartalent/CharTalentModel';
import { CHARACTER_LABEL, CharacterId, CHARACTERS } from '../../inventory/EquipDefs';
import type { CharacterGrowthModel } from '../../growth/CharacterGrowthModel';

interface PanelHot {
    rect: { x: number; y: number; w: number; h: number };
    act: () => void;
}

export interface CharTalentPanelOptions {
    host: Node;
    halfW: number;
    halfH: number;
    getSave: () => CharTalentSave;                     // 组合根缓存，learnNode/resetChar 就地写
    getGrowth: () => CharacterGrowthModel | null;
    beforeShow: () => void;
    persist: () => void;                               // 投点/洗点成功后落盘
}

const STAT_LABEL: Record<string, string> = {
    hp: '生命', atk: '攻击', def: '防御', hpPct: '生命', atkPct: '攻击', defPct: '防御',
    attackSpeed: '攻速', critRate: '暴击率', critDmg: '暴击伤害', dodgeRate: '闪避',
    blockRate: '格挡率', blockRatio: '格挡强度', dmgReduce: '免伤', moveSpeedPct: '移速',
    skillHaste: '技能急速', basicDmgBonus: '普攻伤害', skillDmgBonus: '技能伤害',
    singleDmgBonus: '单体伤害', aoeDmgBonus: '群体伤害',
};
const PCT_KEYS = new Set(['hpPct', 'atkPct', 'defPct', 'moveSpeedPct', 'critRate', 'dodgeRate',
    'blockRate', 'blockRatio', 'dmgReduce', 'skillHaste', 'basicDmgBonus', 'skillDmgBonus',
    'singleDmgBonus', 'aoeDmgBonus', 'attackSpeed', 'critDmg']);

// 节点效果摘要：stat → 当前累计值；passive → 名称+当前级
function fmtEffect(node: CharTalentNodeDef, lv: number): string {
    if (node.kind === 'passive') {
        const def = charTalentPassiveAt(node.id, Math.max(1, lv));
        return lv > 0 ? `被动·${def?.name ?? node.label}` : `被动（未学）`;
    }
    const name = STAT_LABEL[node.statKey] ?? node.statKey;
    const v = node.valuePerLevel * Math.max(1, lv);   // 未投时展示 1 级效果
    if (PCT_KEYS.has(node.statKey)) return `${name} +${Math.round(v * 1000) / 10}%`;
    return `${name} +${v}`;
}

export class CharTalentPanel {
    private readonly root: Node;
    private readonly gfx: Graphics;
    private readonly labels: Label[] = [];
    private readonly hots: PanelHot[] = [];
    private activeCls: CharacterId = 'tank';
    private resetArmed = false;
    private message = '';

    constructor(private readonly options: CharTalentPanelOptions) {
        this.root = new Node('CharTalentView');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);

        const gfxNode = new Node('CharTalentGfx');
        gfxNode.layer = this.root.layer;
        gfxNode.addComponent(UITransform);
        this.gfx = gfxNode.addComponent(Graphics);
        this.root.addChild(gfxNode);
        options.host.addChild(this.root);
        this.root.active = false;
        this.root.on(Node.EventType.TOUCH_END, this.onTap, this);
    }

    isOpen(): boolean { return this.root.active; }

    toggle(): void {
        if (this.isOpen()) this.hide();
        else this.show();
    }

    show(cls?: CharacterId): void {
        this.options.beforeShow();
        if (cls) this.activeCls = cls;
        this.message = '';
        this.resetArmed = false;
        this.root.active = true;
        this.root.setSiblingIndex(this.options.host.children.length - 1);
        this.render();
    }

    hide(): void { this.root.active = false; }

    destroy(): void {
        this.root.off(Node.EventType.TOUCH_END, this.onTap, this);
    }

    private labelAt(i: number): Label {
        while (i >= this.labels.length) {
            const node = new Node('CharTalentLbl');
            node.layer = this.root.layer;
            node.addComponent(UITransform);
            const label = node.addComponent(Label);
            this.root.addChild(node);
            this.labels.push(label);
        }
        return this.labels[i];
    }

    private render(): void {
        const g = this.gfx;
        g.clear();
        this.hots.length = 0;
        for (const label of this.labels) label.node.active = false;
        let li = 0;
        const label = (text: string, x: number, y: number, size = 20, color?: Color) => {
            const item = this.labelAt(li++);
            item.node.active = true;
            item.string = text;
            item.fontSize = size;
            item.color = color ?? new Color(235, 235, 240, 255);
            item.node.setPosition(x, y, 0);
        };

        g.fillColor = new Color(18, 22, 28, 235);
        g.rect(-this.options.halfW, -this.options.halfH, this.options.halfW * 2, this.options.halfH * 2);
        g.fill();

        const save = this.options.getSave();
        const cls = this.activeCls;
        const charLevel = this.options.getGrowth()?.levelOf(cls) ?? 1;
        const points = availablePoints(save, cls, charLevel);
        label(`角色天赋  ${CHARACTER_LABEL[cls]} Lv.${charLevel}  剩余 ${points} 点`, 0, 640, 28, new Color(255, 226, 126, 255));
        label('每升 1 级得 1 点；达到等级门槛即可投点，随时免费洗点', 0, 600, 16, new Color(170, 178, 194, 255));

        // 职业页签
        const tabW = 200, tabH = 60;
        CHARACTERS.forEach((c, i) => {
            const x = -tabW * 1.5 - 20 + i * (tabW + 20);
            const active = c === cls;
            g.fillColor = active ? new Color(64, 90, 130, 255) : new Color(44, 48, 56, 255);
            g.roundRect(x, 530, tabW, tabH, 10);
            g.fill();
            label(CHARACTER_LABEL[c], x + tabW / 2, 560, 22, active ? undefined : new Color(150, 156, 168, 255));
            if (!active) this.hots.push({ rect: { x, y: 530, w: tabW, h: tabH }, act: () => { this.activeCls = c; this.message = ''; this.resetArmed = false; this.render(); } });
        });

        // 节点网格：行 = tier（等级门槛层），每层 1~2 节点左右排
        const nodeW = 380, nodeH = 96;
        const tiers = new Map<number, CharTalentNodeDef[]>();
        for (const node of charTalentNodes(cls)) {
            const list = tiers.get(node.tier) ?? [];
            list.push(node);
            tiers.set(node.tier, list);
        }
        let y = 440;
        for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
            const list = tiers.get(tier)!;
            label(`Lv.${list[0].levelReq}`, -440, y, 18, new Color(170, 178, 194, 255));
            list.forEach((node, i) => {
                const x = list.length === 1 ? -nodeW / 2 : -nodeW - 10 + i * (nodeW + 20);
                const lv = nodeLevelOf(save, cls, node.id);
                const maxed = lv >= node.maxLevel;
                const gated = charLevel < node.levelReq;
                g.fillColor = maxed ? new Color(146, 116, 44, 255)
                    : gated ? new Color(44, 48, 56, 255)
                    : new Color(52, 74, 104, 255);
                g.roundRect(x, y - nodeH / 2, nodeW, nodeH, 10);
                g.fill();
                const textColor = gated ? new Color(120, 126, 138, 255) : undefined;
                label(`${node.label}  ${lv}/${node.maxLevel}`, x + nodeW / 2, y + 18, 20, textColor);
                const sub = gated ? `Lv.${node.levelReq} 解锁` : fmtEffect(node, lv);
                label(sub, x + nodeW / 2, y - 16, 15, maxed ? new Color(255, 226, 126, 255) : textColor);
                if (!maxed && !gated) {
                    this.hots.push({ rect: { x, y: y - nodeH / 2, w: nodeW, h: nodeH }, act: () => this.learn(node.id) });
                }
            });
            y -= 130;
        }

        // 洗点（两击确认）
        g.fillColor = this.resetArmed ? new Color(150, 80, 50, 255) : new Color(70, 74, 84, 255);
        g.roundRect(-210, -600, 420, 56, 10);
        g.fill();
        label(this.resetArmed ? '再点一次确认洗点（免费，清空本角色全部投点）' : '洗点（免费）', 0, -572, 20);
        this.hots.push({ rect: { x: -210, y: -600, w: 420, h: 56 }, act: () => this.reset() });

        if (this.message) label(this.message, 0, -650, 18, new Color(255, 160, 140, 255));

        g.fillColor = new Color(120, 60, 60, 255);
        g.roundRect(-90, -730, 180, 60, 12);
        g.fill();
        label('关闭', 0, -700, 24);
        this.hots.push({ rect: { x: -90, y: -730, w: 180, h: 60 }, act: () => this.hide() });
    }

    private learn(nodeId: string): void {
        const charLevel = this.options.getGrowth()?.levelOf(this.activeCls) ?? 1;
        const r = learnNode(this.options.getSave(), this.activeCls, nodeId, charLevel);
        if (r.ok) {
            this.message = '';
            this.options.persist();
        } else {
            this.message = r.reason ?? '无法学习';
        }
        this.resetArmed = false;
        this.render();
    }

    private reset(): void {
        if (!this.resetArmed) {
            this.resetArmed = true;
            this.render();
            return;
        }
        resetChar(this.options.getSave(), this.activeCls);
        this.resetArmed = false;
        this.message = '';
        this.options.persist();
        this.render();
    }

    private onTap(e: EventTouch): void {
        const ui = e.getUILocation();
        const p = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        for (const hot of this.hots) {
            const rect = hot.rect;
            if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) {
                hot.act();
                return;
            }
        }
    }
}
```

注：`CHARACTERS`/`CharacterId` 若在 EquipDefs 的导出名不同（实现时以 `assets/scripts/inventory/EquipDefs.ts` 实际导出为准），对应调整 import。

- [ ] **Step 2: MainScreenView 入口**

options 接口（`onTalent` 行后）加：

```ts
    onCharTalent: () => void;   // 角色天赋面板（左上角头像热区）
```

`addHotZone` 区（`GoldHot` 行前）加：

```ts
        this.addHotZone('AvatarHot', { x: 8, y: 10, w: 165, h: 165 }, this.options.onCharTalent, 'HudAvatar', 'avatar');
```

- [ ] **Step 3: BattleStageView 透传**

options 接口（`onTalent` 行后）加 `onCharTalent: () => void;`；`new MainScreenView({...})` 里 `onTalent: options.onTalent,` 后加 `onCharTalent: options.onCharTalent,`。

- [ ] **Step 4: SquadPanel 每行「天赋」按钮**

options 加 `onCharTalent: (cls: SoldierClass) => void;`。`render()` 的 `pushRow` 改为（行主体热区让出右侧两钮位；天赋钮常驻最右、↑钮在其左）：

```ts
        const pushRow = (cls: SoldierClass, y: number, tag: string, onRow: () => void, upBtn?: () => void) => {
            g.fillColor = new Color(48, 58, 72, 255);
            g.roundRect(x0, y - rowH / 2, rowW, rowH - 12, 10);
            g.fill();
            label(`${tag}  ${nameWithLevel(cls)}`, x0 + 20, y, 24);
            this.hots.push({ rect: { x: x0, y: y - rowH / 2, w: rowW - 180, h: rowH - 12 }, act: onRow });
            // 天赋按钮（最右）
            g.fillColor = new Color(146, 116, 44, 255);
            g.roundRect(x0 + rowW - 84, y - rowH / 2, 72, rowH - 12, 10);
            g.fill();
            label('天赋', x0 + rowW - 48, y, 20);
            this.hots.push({ rect: { x: x0 + rowW - 84, y: y - rowH / 2, w: 72, h: rowH - 12 }, act: () => this.options.onCharTalent(cls) });
            if (upBtn) {
                g.fillColor = new Color(80, 120, 160, 255);
                g.roundRect(x0 + rowW - 168, y - rowH / 2, 72, rowH - 12, 10);
                g.fill();
                label('↑', x0 + rowW - 132, y, 30);
                this.hots.push({ rect: { x: x0 + rowW - 168, y: y - rowH / 2, w: 72, h: rowH - 12 }, act: upBtn });
            }
        };
```

调用点同步改签名（`nameWithLevel` 移到 pushRow 之前定义）：

```ts
        let y = 420;
        deployed.forEach((cls, index) => {
            pushRow(cls, y, `出战${index + 1}`, () => this.undeploy(cls), index > 0 ? () => this.move(cls, index - 1) : undefined);
            y -= rowH;
        });
        y -= 24;
        for (const cls of squad.benchList()) {
            pushRow(cls, y, '板凳', () => this.deploy(cls));
            y -= rowH;
        }
```

- [ ] **Step 5: BattleEntry 装配**

字段区加 `private _charTalentPanel: CharTalentPanel = null!;`，导入 `CharTalentPanel`。
面板实例化区（TalentPanel 之后）加：

```ts
        this._charTalentPanel = new CharTalentPanel({
            host: this.node,
            halfW: this._halfW,
            halfH: this._halfH,
            getSave: () => this._charTalents,
            getGrowth: () => this._growth,
            beforeShow: () => {
                this._settlementPanel.hide();
                this._chestPanel.hide();
                this._craftPanel.hide();
                this._squadPanel.hide();
                this._talentPanel.hide();
            },
            persist: () => { void this._persistCharTalents(); },
        });
```

BattleStageView options 加 `onCharTalent: () => this._charTalentPanel.toggle(),`；
SquadPanel options 加 `onCharTalent: (cls) => this._charTalentPanel.show(cls),`；
`onDestroy` 清理区加 `this._charTalentPanel?.destroy();`。

- [ ] **Step 6: 编译验证**

Run: `npm run typecheck`
Expected: 双环境 0 error。

- [ ] **Step 7: 暂存**

```bash
git add assets/scripts/ui/panels/CharTalentPanel.ts assets/scripts/ui/MainScreenView.ts assets/scripts/ui/BattleStageView.ts assets/scripts/ui/panels/SquadPanel.ts assets/scripts/BattleEntry.ts
```

---

### Task 10: 全量回归 + 文档收尾

**Files:**
- Modify: `ai/memory/项目状态.md`（最近进展 + 待办）
- Modify: `ai/memory/代码地图.md`（新增 chartalent 章节）
- Modify: `ai/memory/设计日志.md`（方向性决策追加）

- [ ] **Step 1: 全量验证**

Run: `npm run verify`
Expected: typecheck 双环境 + 全部单测（含新 test:chartalent）+ balance:check + sim:pacing 13 门槛 + check:art + check:ui-alpha 全绿。

- [ ] **Step 2: 推进模拟基线不动**

Run: `npm run sim:progress`
Expected: 与基线一致（总局数中位 40 附近、20/20 通关；sim 不传天赋，零影响验证）。

- [ ] **Step 3: 按 ai/skills/开发收尾.md 走收尾**

- `项目状态.md` 最近进展加一条：角色天赋系统落地（spec/计划路径、13 节点×3 职业、128>99 取舍、免费洗点、剩用户 Cocos 预览人工验收：开面板→投点→被动开战触发→洗点→切角色/切账号隔离）。
- `代码地图.md` 在心法章节后加「角色天赋（chartalent/）」章节：三文件+导表+测试+UI+接线说明（表格式，对齐心法章节风格）。
- `设计日志.md` 追加方向性决策（带日期+理由）：①等级门槛制而非节点连线；②容量>供给强制取舍+免费洗点组合；③被动分级用 Buff 层数承载；④技能点派生不存档。

- [ ] **Step 4: 暂存**

```bash
git add ai/memory/项目状态.md ai/memory/代码地图.md ai/memory/设计日志.md
```

---

## 自审记录

- **Spec 覆盖**：§3.1 点数派生（Task 5）✓ §3.2 结构/校验（Task 1/3/5）✓ §3.3 双类节点效果（Task 1/2/6）✓ §3.4 占位内容（Task 1 数值总表）✓ §4 数据模块（Task 1~6）✓ §5 接线四条（Task 7/8）✓ §6 UI 与两入口（Task 9）✓ §7 测试验收（各任务 + Task 10）✓ §8 不做的事（计划无对应任务）✓
- **类型一致性**：`CharTalentSave`/`charTalentAggregate`/`buildEffectiveStatsMap` 第 4 参/`BattleManager` 第 6 参在 Task 4~9 间签名一致；`PassiveDef` 复用 `config/SkillConfig` 既有类型。
- **占位扫描**：无 TBD/TODO；所有代码步骤给出完整代码。
