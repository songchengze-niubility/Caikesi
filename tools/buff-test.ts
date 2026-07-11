// BuffSystem 测试（纯逻辑，tsx 运行）。用手工构造的 BuffDef，不依赖 buff.xlsx 数值。
import assert from 'node:assert/strict';
import { applyBuffStack, dispelByTag, tickBuffs, buffedStats, buffGate, type BuffInstance } from '../assets/scripts/combat/BuffSystem';
import type { BuffDef } from '../assets/scripts/config/BuffConfig';
import { BattleConfig } from '../assets/scripts/config/BattleConfig';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }

function mkDef(p: Partial<BuffDef>): BuffDef {
    return {
        id: 'b', name: 'B', duration: 5, maxStacks: 1, stackRule: 'refresh',
        period: 0, periodicEffect: null, statMods: [], flags: [], dispelTag: '', ...p,
    };
}
const defs = new Map<string, BuffDef>();
const getDef = (id: string) => defs.get(id);
function put(d: BuffDef) { defs.set(d.id, d); return d; }

test('refresh：重复施加重置时长不叠层', () => {
    const d = put(mkDef({ id: 'r', duration: 5 }));
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d, 10);
    tickBuffs(buffs, 3, getDef, () => {}, () => {});
    applyBuffStack(buffs, d, 10);
    assert.equal(buffs.length, 1);
    assert.equal(buffs[0].stacks, 1);
    assert.equal(buffs[0].remaining, 5);
});

test('add：叠层钳 maxStacks 且刷新时长', () => {
    const d = put(mkDef({ id: 'a', duration: 6, maxStacks: 3, stackRule: 'add' }));
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d, 10); applyBuffStack(buffs, d, 10); applyBuffStack(buffs, d, 10); applyBuffStack(buffs, d, 10);
    assert.equal(buffs.length, 1);
    assert.equal(buffs[0].stacks, 3);
    assert.equal(buffs[0].remaining, 6);
});

test('tick：到期移除并回调，返回脏', () => {
    const d = put(mkDef({ id: 'e', duration: 1 }));
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d, 10);
    const expired: string[] = [];
    const dirty = tickBuffs(buffs, 1.5, getDef, () => {}, def => expired.push(def.id));
    assert.equal(dirty, true);
    assert.equal(buffs.length, 0);
    assert.deepEqual(expired, ['e']);
    // 未到期不脏
    applyBuffStack(buffs, d, 10);
    assert.equal(tickBuffs(buffs, 0.2, getDef, () => {}, () => {}), false);
});

test('周期：2.5 秒 period=1 触发 2 次（单帧跨多周期补触发）', () => {
    const d = put(mkDef({ id: 'p', duration: 10, period: 1, periodicEffect: { kind: 'damage', mult: 0.5 } }));
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d, 10);
    let fires = 0;
    tickBuffs(buffs, 2.5, getDef, () => fires++, () => {});
    assert.equal(fires, 2);
    tickBuffs(buffs, 0.6, getDef, () => fires++, () => {});
    assert.equal(fires, 3);   // 累计 3.1 秒 → 第 3 跳
});

test('buffedStats：flat×层数 + pct×层数，概率钳 [0,1]，不改 base', () => {
    const d = put(mkDef({ id: 's', maxStacks: 2, stackRule: 'add', statMods: [
        { key: 'atk', flat: 5, pct: 0 }, { key: 'atk', flat: 0, pct: 0.1 }, { key: 'dodgeRate', flat: 0.9, pct: 0 },
    ]}));
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d, 0, 2);
    const base = { ...BattleConfig.stats.dps, atk: 100, dodgeRate: 0.5 };
    const out = buffedStats(base, buffs, getDef);
    assert.equal(out.atk, 100 + 5 * 2 + 100 * 0.1 * 2);
    assert.equal(out.dodgeRate, 1);
    assert.equal(base.atk, 100);
    assert.equal(base.dodgeRate, 0.5);
});

test('永久 Buff（duration=-1）：tick 100 秒不掉且属性聚合有效', () => {
    const d = put(mkDef({ id: 'perm', duration: -1, statMods: [{ key: 'atk', flat: 10, pct: 0 }] }));
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d, 0);
    for (let i = 0; i < 100; i++) tickBuffs(buffs, 1, getDef, () => {}, () => {});
    assert.equal(buffs.length, 1, '永久 Buff 不应到期');
    const base = { ...BattleConfig.stats.dps, atk: 100 };
    assert.equal(buffedStats(base, buffs, getDef).atk, 110);
});

test('永久周期 Buff：不到期但周期照跳', () => {
    const d = put(mkDef({ id: 'permTick', duration: -1, period: 1, periodicEffect: { kind: 'damage', mult: 0.1 } }));
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d, 10);
    let fires = 0;
    tickBuffs(buffs, 2.5, getDef, () => fires++, () => {});
    assert.equal(fires, 2);
    assert.equal(buffs.length, 1);
});

test('dispel：按标签移除至多 count 个；gate：stun 关门', () => {
    const d1 = put(mkDef({ id: 'x1', dispelTag: 'debuff' }));
    const d2 = put(mkDef({ id: 'x2', dispelTag: 'debuff', flags: ['stun'] }));
    const buffs: BuffInstance[] = [];
    applyBuffStack(buffs, d1, 0); applyBuffStack(buffs, d2, 0);
    assert.equal(buffGate(buffs, getDef).canMove, false);
    assert.equal(buffGate(buffs, getDef).canAct, false);
    const dirty = dispelByTag(buffs, getDef, 'debuff', 1);
    assert.equal(dirty, true);
    assert.equal(buffs.length, 1);
    assert.equal(dispelByTag(buffs, getDef, 'nothing', 9), false);
});

let failed = 0;
for (const t of tests) {
    try { t.run(); console.log(`  ✓ ${t.name}`); }
    catch (e) { failed++; console.error(`  ✗ ${t.name}`); console.error(e); }
}
console.log(`\nBuff 系统测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
