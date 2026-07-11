// applyEffect 管线测试（纯逻辑，tsx 运行）。
// 单元部分用手工 hooks 收集调用；集成部分走真 BattleManager（stun 行为门 + 中毒周期跳伤）。
import assert from 'node:assert/strict';
import { applyEffect, type EffectHooks } from '../assets/scripts/combat/Effects';
import { createSoldierUnit, recomputeDerived, type CombatUnit } from '../assets/scripts/combat/CombatUnit';
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { BattleConfig, type CombatStats } from '../assets/scripts/config/BattleConfig';
import { getBuffDef } from '../assets/scripts/config/BuffConfig';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }

// 确定性面板：无暴击/闪避/格挡
function mkStats(p: Partial<CombatStats>): CombatStats {
    return {
        ...BattleConfig.stats.dps,
        critRate: 0, dodgeRate: 0, blockRate: 0, dmgBonus: 0, dmgReduce: 0,
        ...p,
    };
}
function mkUnit(stats: CombatStats): CombatUnit {
    return createSoldierUnit(0, 'dps', stats, 0, 0);
}
function mkHooks() {
    const calls = { floats: 0, deaths: 0, buffEvents: [] as { buffId: string; applied: boolean }[] };
    const hooks: EffectHooks = {
        spawnFloat: () => { calls.floats++; },
        markDead: (u) => { calls.deaths++; u.alive = false; u.hp = 0; },
        onBuffChanged: (_t, buffId, applied) => { calls.buffEvents.push({ buffId, applied }); },
    };
    return { hooks, calls };
}

test('damage：与减法公式等价，扣血+飘字，不致死不叫 markDead', () => {
    const src = mkUnit(mkStats({ atk: 50 }));
    const tgt = mkUnit(mkStats({ hp: 1000, def: 10 }));
    const { hooks, calls } = mkHooks();
    const out = applyEffect(src, tgt, { kind: 'damage', mult: 1 }, hooks);
    const expected = Math.max(1, Math.round(Math.max(50 - 10, 50 * BattleConfig.combat.minDamageRate)));
    assert.equal(out.damage, expected);
    assert.equal(tgt.hp, tgt.maxHp - expected);
    assert.equal(calls.floats, 1);
    assert.equal(calls.deaths, 0);
});

test('damage：致死走 markDead；倍率放大', () => {
    const src = mkUnit(mkStats({ atk: 100 }));
    const tgt = mkUnit(mkStats({ hp: 50, def: 0 }));
    const { hooks, calls } = mkHooks();
    const out = applyEffect(src, tgt, { kind: 'damage', mult: 2 }, hooks, 'skill');
    assert.equal(out.damage, 200);
    assert.equal(calls.deaths, 1);
    assert.equal(tgt.alive, false);
});

test('heal：按施法者 atk 倍率回血，封顶 maxHp', () => {
    const src = mkUnit(mkStats({ atk: 40 }));
    const tgt = mkUnit(mkStats({ hp: 100 }));
    tgt.hp = 50;
    const { hooks } = mkHooks();
    applyEffect(src, tgt, { kind: 'heal', mult: 1 }, hooks);
    assert.equal(tgt.hp, 90);
    applyEffect(src, tgt, { kind: 'heal', mult: 10 }, hooks);
    assert.equal(tgt.hp, tgt.maxHp);
});

test('applyBuff：stats 切副本且加成生效；dispel 后恢复 baseStats 引用', () => {
    const src = mkUnit(mkStats({ atk: 40 }));
    const tgt = mkUnit(mkStats({ atk: 100 }));
    assert.equal(tgt.stats, tgt.baseStats);   // 无 buff：同一引用
    const { hooks, calls } = mkHooks();
    applyEffect(src, tgt, { kind: 'applyBuff', buffId: 'battle_cry', stacks: 1 }, hooks);   // atk%:0.25
    assert.notEqual(tgt.stats, tgt.baseStats);
    assert.equal(tgt.stats.atk, 100 + 100 * 0.25);
    assert.deepEqual(calls.buffEvents, [{ buffId: 'battle_cry', applied: true }]);
    applyEffect(src, tgt, { kind: 'dispel', tag: 'buff', count: 9 }, hooks);
    assert.equal(tgt.buffs.length, 0);
    assert.equal(tgt.stats, tgt.baseStats);   // 恢复引用（ConfigPanel 调参依赖）
});

test('未知 buffId / knockback / summon：no-op 不炸', () => {
    const src = mkUnit(mkStats({}));
    const tgt = mkUnit(mkStats({}));
    const { hooks, calls } = mkHooks();
    applyEffect(src, tgt, { kind: 'applyBuff', buffId: 'no_such_buff', stacks: 1 }, hooks);
    applyEffect(src, tgt, { kind: 'knockback', distance: 100 }, hooks);
    applyEffect(src, tgt, { kind: 'summon', unitType: 'grunt', count: 2 }, hooks);
    assert.equal(tgt.buffs.length, 0);
    assert.equal(calls.buffEvents.length, 0);
});

// —— BattleManager 集成 ——
// range=0 的 dps 不会普攻/放技能（timer 技能 8s 起，测试窗口内不触发），隔离被测路径。
function mkQuietManager(): BattleManager {
    return new BattleManager(470, 836, 0, {
        dps: mkStats({ atk: 100, range: 0, hp: 99999 }),
    }, ['dps']);
}
function firstEnemy(mgr: BattleManager): CombatUnit {
    for (let i = 0; i < 100 && mgr.enemies.length === 0; i++) mgr.tick(0.05);
    assert.ok(mgr.enemies.length > 0, '应已刷出敌人');
    return mgr.enemies[0];
}

test('集成：stun 行为门——被眩晕的怪一帧不推进，到期恢复', () => {
    const mgr = mkQuietManager();
    const e = firstEnemy(mgr);
    const stunDef = getBuffDef('stun');
    assert.ok(stunDef, 'buff.xlsx 应有 stun');
    // 经 BattleManager 的事件出口施加：直接用 applyEffect + 管理器内部钩子等价（此处走公开路径）
    applyEffect(mgr.soldiers[0], e, { kind: 'applyBuff', buffId: 'stun', stacks: 1 }, {
        spawnFloat: () => {}, markDead: () => {}, onBuffChanged: () => {},
    });
    assert.equal(e.gate.canMove, false);
    const x0 = e.x;
    mgr.tick(0.1);
    assert.equal(e.x, x0);                     // 眩晕不动
    for (let i = 0; i < 20; i++) mgr.tick(0.1); // 累计 2.1s > 眩晕 1.5s
    assert.equal(e.gate.canMove, true);
    assert.ok(e.x < x0, '眩晕到期应恢复推进');
    // 到期事件从 BattleManager 事件流吐出
    const evts = mgr.drainEvents().filter(ev => ev.type === 'buffChanged');
    assert.ok(evts.some(ev => ev.type === 'buffChanged' && ev.buffId === 'stun' && !ev.applied));
});

test('集成：poison 周期跳伤按 srcAtk 结算', () => {
    const mgr = mkQuietManager();
    const e = firstEnemy(mgr);
    applyEffect(mgr.soldiers[0], e, { kind: 'applyBuff', buffId: 'poison', stacks: 1 }, {
        spawnFloat: () => {}, markDead: () => {}, onBuffChanged: () => {},
    });
    const hp0 = e.hp;
    for (let i = 0; i < 21; i++) mgr.tick(0.05);   // 1.05s → 1 跳
    const expected = Math.max(1, Math.round(100 * 0.15 * 1));   // srcAtk=100, mult=0.15
    assert.equal(e.hp, hp0 - expected);
});

let failed = 0;
for (const t of tests) {
    try { t.run(); console.log(`  ✓ ${t.name}`); }
    catch (e) { failed++; console.error(`  ✗ ${t.name}`); console.error(e); }
}
console.log(`\nEffect 管线测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
