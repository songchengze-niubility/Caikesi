// 控制三件套测试（纯逻辑，tsx 运行）：行为门聚合 / 击退钳制+事件 / 嘲讽拉仇恨 / 沉默禁技。
import assert from 'node:assert/strict';
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { applyEffect } from '../assets/scripts/combat/Effects';
import { buffGate, applyBuffStack, type BuffInstance } from '../assets/scripts/combat/BuffSystem';
import type { CombatUnit } from '../assets/scripts/combat/CombatUnit';
import { UnitSkills } from '../assets/scripts/combat/SkillRuntime';
import type { BuffDef } from '../assets/scripts/config/BuffConfig';
import { getBuffDef } from '../assets/scripts/config/BuffConfig';
import type { SkillDef } from '../assets/scripts/config/SkillConfig';
import { BattleConfig, type CombatStats } from '../assets/scripts/config/BattleConfig';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }

function mkStats(p: Partial<CombatStats>): CombatStats {
    return { ...BattleConfig.stats.dps, critRate: 0, dodgeRate: 0, blockRate: 0, dmgBonus: 0, dmgReduce: 0, ...p };
}
const dummyHooks = { spawnFloat: () => {}, markDead: () => {}, onBuffChanged: () => {}, applyKnockback: () => {} };

test('buffGate：stun 关三门、silence 只关 canCast、taunt 标记 taunting', () => {
    const mk = (p: Partial<BuffDef>): BuffDef => ({
        id: 'x', name: 'X', duration: 5, maxStacks: 1, stackRule: 'refresh',
        period: 0, periodicEffect: null, statMods: [], flags: [], dispelTag: '', ...p,
    });
    const defs = new Map<string, BuffDef>([
        ['st', mk({ id: 'st', flags: ['stun'] })],
        ['si', mk({ id: 'si', flags: ['silence'] })],
        ['ta', mk({ id: 'ta', flags: ['taunt'] })],
    ]);
    const getDef = (id: string) => defs.get(id);
    const buffs: BuffInstance[] = [];
    assert.deepEqual(buffGate(buffs, getDef), { canMove: true, canAct: true, canCast: true, taunting: false });
    applyBuffStack(buffs, defs.get('si')!, 0);
    assert.deepEqual(buffGate(buffs, getDef), { canMove: true, canAct: true, canCast: false, taunting: false });
    applyBuffStack(buffs, defs.get('ta')!, 0);
    assert.equal(buffGate(buffs, getDef).taunting, true);
    applyBuffStack(buffs, defs.get('st')!, 0);
    const g = buffGate(buffs, getDef);
    assert.deepEqual([g.canMove, g.canAct, g.canCast], [false, false, false]);
});

function mkQuietManager(roster: ('tank' | 'dps' | 'healer')[] = ['dps']): BattleManager {
    const eff: Record<string, CombatStats> = {};
    for (const c of roster) eff[c] = mkStats({ ...BattleConfig.stats[c], atk: 30, range: 0, hp: 99999, critRate: 0, dodgeRate: 0, blockRate: 0 });
    return new BattleManager(470, 836, 0, eff, roster);
}
function firstEnemy(mgr: BattleManager): CombatUnit {
    for (let i = 0; i < 100 && mgr.enemies.length === 0; i++) mgr.tick(0.05);
    assert.ok(mgr.enemies.length > 0);
    const e = mgr.enemies[0];
    e.moveSpeed = 0;
    return e;
}

test('knockback：敌人 +x 推离且钳 halfW，事件吐出；我方 −x 且钳左界', () => {
    const mgr = mkQuietManager();
    const e = firstEnemy(mgr);
    e.x = 100;
    mgr.drainEvents();
    const hooks = (mgr as any)._effectHooks;
    applyEffect(mgr.soldiers[0], e, { kind: 'knockback', distance: 120 }, hooks);
    assert.equal(e.x, 220, '敌人应被推离 +x');
    e.x = 460;
    applyEffect(mgr.soldiers[0], e, { kind: 'knockback', distance: 120 }, hooks);
    assert.equal(e.x, 470, '钳制在 halfW');
    const s = mgr.soldiers[0];
    s.x = -440;
    hooks.applyKnockback(s, 120);
    assert.equal(s.x, -450, '我方 −x 且钳 -halfW+20');
    const evts = mgr.drainEvents().filter(ev => ev.type === 'knockback');
    assert.equal(evts.length, 3);
});

test('taunt：敌人贴身攻击优先打带嘲讽的士兵', () => {
    assert.ok(getBuffDef('taunt_shout'), 'buff.xlsx 应有 taunt_shout');
    const mgr = mkQuietManager(['tank', 'dps']);
    const e = firstEnemy(mgr);
    const tank = mgr.soldiers[0], dps = mgr.soldiers[1];
    // 敌人钉在防线上（front = 防线 + contactGap），直接进入贴身攻击分支
    const front = Math.max(tank.homeX, dps.homeX) + BattleConfig.formation.contactGap;
    e.x = front; e.y = 0;
    // 无嘲讽：打最近的（tank 在前排更近）
    const tankHp0 = tank.hp, dpsHp0 = dps.hp;
    for (let i = 0; i < 30; i++) mgr.tick(0.05);
    assert.ok(tank.hp < tankHp0, '默认打最近的前排');
    assert.equal(dps.hp, dpsHp0);
    // 给后排 dps 挂嘲讽：改打 dps
    applyEffect(dps, dps, { kind: 'applyBuff', buffId: 'taunt_shout', stacks: 1 }, (mgr as any)._effectHooks);
    assert.equal(dps.gate.taunting, true);
    const tankHp1 = tank.hp, dpsHp1 = dps.hp;
    for (let i = 0; i < 30; i++) mgr.tick(0.05);
    assert.ok(dps.hp < dpsHp1, '嘲讽期间应打 taunting 者');
    assert.equal(tank.hp, tankHp1, '前排不再挨打');
});

test('silence：技能进度照走但禁释放，驱散后恢复释放', () => {
    assert.ok(getBuffDef('silence_seal'), 'buff.xlsx 应有 silence_seal');
    const mgr = mkQuietManager();
    firstEnemy(mgr);
    const s = mgr.soldiers[0];
    const def: SkillDef = {
        id: 't', name: '测试', cls: 'dps', trigger: 'timer', triggerValue: 0.1,
        target: 'nearest', radius: 0, maxTargets: 1, effects: [{ kind: 'damage', mult: 1 }],
        delivery: null,
    };
    s.skills = new UnitSkills([def]);
    applyEffect(s, s, { kind: 'applyBuff', buffId: 'silence_seal', stacks: 1 }, (mgr as any)._effectHooks);
    assert.equal(s.gate.canCast, false);
    mgr.drainEvents();
    for (let i = 0; i < 10; i++) mgr.tick(0.05);
    assert.equal(mgr.drainEvents().filter(ev => ev.type === 'skillCast').length, 0, '沉默期间不释放');
    assert.equal(s.skills.progress(0), 1, '进度照走并就绪保留');
    applyEffect(s, s, { kind: 'dispel', tag: 'debuff', count: 9 }, (mgr as any)._effectHooks);
    assert.equal(s.gate.canCast, true);
    for (let i = 0; i < 4; i++) mgr.tick(0.05);
    assert.ok(mgr.drainEvents().some(ev => ev.type === 'skillCast'), '解除后应立即释放');
});

let failed = 0;
for (const t of tests) {
    try { t.run(); console.log(`  ✓ ${t.name}`); }
    catch (e) { failed++; console.error(`  ✗ ${t.name}`); console.error(e); }
}
console.log(`\n控制测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
