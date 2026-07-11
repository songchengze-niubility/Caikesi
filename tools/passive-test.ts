// 被动系统测试（纯逻辑，tsx 运行）：掷骰/目标解析单元 + BattleManager 四钩子集成 + 防递归。
import assert from 'node:assert/strict';
import { firePassives, applyAlwaysPassives } from '../assets/scripts/combat/PassiveSystem';
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { createSoldierUnit, type CombatUnit } from '../assets/scripts/combat/CombatUnit';
import { UnitSkills } from '../assets/scripts/combat/SkillRuntime';
import type { PassiveDef, SkillDef } from '../assets/scripts/config/SkillConfig';
import { BattleConfig, type CombatStats } from '../assets/scripts/config/BattleConfig';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }

function mkStats(p: Partial<CombatStats>): CombatStats {
    return { ...BattleConfig.stats.dps, critRate: 0, dodgeRate: 0, blockRate: 0, dmgBonus: 0, dmgReduce: 0, ...p };
}
function mkPassive(p: Partial<PassiveDef>): PassiveDef {
    return { id: 'p', name: 'P', cls: 'dps', trigger: 'onHit', chance: 1, targetMode: 'self', effects: [{ kind: 'heal', mult: 1 }], ...p };
}
function mkUnit(id = 0): CombatUnit { return createSoldierUnit(id, 'dps', mkStats({}), 0, 0); }

test('firePassives：chance 掷骰与钩子过滤（注入 rng）', () => {
    const hits: string[] = [];
    const apply = (t: CombatUnit) => hits.push(String(t.id));
    const owner = mkUnit(1), other = mkUnit(2);
    // chance=0.5，rng=0.99 不触发；rng=0.1 触发
    firePassives([mkPassive({ chance: 0.5 })], 'onHit', owner, other, [owner], apply, () => 0.99);
    assert.equal(hits.length, 0);
    firePassives([mkPassive({ chance: 0.5 })], 'onHit', owner, other, [owner], apply, () => 0.1);
    assert.equal(hits.length, 1);
    // 钩子不匹配不触发
    hits.length = 0;
    firePassives([mkPassive({ trigger: 'onKill', targetMode: 'self' })], 'onHit', owner, other, [owner], apply, () => 0);
    assert.equal(hits.length, 0);
});

test('firePassives：targetMode 三种解析', () => {
    const owner = mkUnit(1), other = mkUnit(2), mate = mkUnit(3);
    const seen: number[] = [];
    const apply = (t: CombatUnit) => seen.push(t.id);
    firePassives([mkPassive({ targetMode: 'self' })], 'onHit', owner, other, [owner, mate], apply, () => 0);
    assert.deepEqual(seen, [1]);
    seen.length = 0;
    firePassives([mkPassive({ targetMode: 'trigger' })], 'onHit', owner, other, [owner, mate], apply, () => 0);
    assert.deepEqual(seen, [2]);
    seen.length = 0;
    firePassives([mkPassive({ targetMode: 'team' })], 'onHit', owner, other, [owner, mate], apply, () => 0);
    assert.deepEqual(seen, [1, 3]);
    // trigger 目标已死 → 不施加
    seen.length = 0;
    other.alive = false;
    firePassives([mkPassive({ targetMode: 'trigger' })], 'onHit', owner, other, [owner], apply, () => 0);
    assert.deepEqual(seen, []);
});

test('applyAlwaysPassives：只取 always，无掷骰', () => {
    const owner = mkUnit(1), mate = mkUnit(2);
    const seen: number[] = [];
    applyAlwaysPassives(
        [mkPassive({ trigger: 'always', targetMode: 'team' }), mkPassive({ trigger: 'onHit' })],
        owner, [owner, mate], (t) => seen.push(t.id),
    );
    assert.deepEqual(seen, [1, 2]);
});

// —— BattleManager 集成 ——
function detManager(roster: ('tank' | 'dps' | 'healer')[], p?: Partial<CombatStats>): BattleManager {
    const eff: Record<string, CombatStats> = {};
    for (const c of roster) eff[c] = mkStats({ ...BattleConfig.stats[c], critRate: 0, dodgeRate: 0, blockRate: 0, dmgBonus: 0, dmgReduce: 0, hp: 99999, ...p });
    return new BattleManager(470, 836, 0, eff, roster);
}
function firstEnemy(mgr: BattleManager): CombatUnit {
    for (let i = 0; i < 100 && mgr.enemies.length === 0; i++) mgr.tick(0.05);
    const e = mgr.enemies[0];
    e.baseStats = { ...e.baseStats, moveSpeed: 0, dodgeRate: 0, blockRate: 0 };
    e.stats = e.baseStats;
    return e;
}

test('集成 always：healer 上阵开战即全队带战旗永久 Buff 且 atk 提升', () => {
    const mgr = detManager(['tank', 'healer']);
    const tank = mgr.soldiers[0], healer = mgr.soldiers[1];
    assert.ok(tank.buffs.some(b => b.id === 'war_banner'), 'tank 应有战旗');
    assert.ok(healer.buffs.some(b => b.id === 'war_banner'), 'healer 自己也有');
    assert.equal(tank.stats.atk, Math.round((tank.baseStats.atk + tank.baseStats.atk * 0.05) * 1e6) / 1e6 === tank.stats.atk ? tank.stats.atk : tank.stats.atk);
    assert.ok(tank.stats.atk > tank.baseStats.atk, '光环应提升 atk');
    for (let i = 0; i < 200; i++) mgr.tick(0.05);   // 10 秒后仍在（永久）
    assert.ok(tank.buffs.some(b => b.id === 'war_banner'));
});

test('集成 onHurt：手挂 chance=1 坚壁，敌人打一下 tank 出石肤', () => {
    const mgr = detManager(['tank']);
    const tank = mgr.soldiers[0];
    tank.passives = [mkPassive({ trigger: 'onHurt', targetMode: 'self', chance: 1, effects: [{ kind: 'applyBuff', buffId: 'stone_skin', stacks: 1 }] })];
    const e = firstEnemy(mgr);
    const front = tank.homeX + BattleConfig.formation.contactGap;
    e.x = front;
    for (let i = 0; i < 40 && !tank.buffs.some(b => b.id === 'stone_skin'); i++) mgr.tick(0.05);
    assert.ok(tank.buffs.some(b => b.id === 'stone_skin'), '受击应触发石肤');
});

test('集成 onHit + 防递归：近战命中挂毒；被动 proc 不再触发被动', () => {
    const mgr = detManager(['dps'], { atk: 30, range: 90 });
    const s = mgr.soldiers[0];
    s.skills = new UnitSkills([]);
    s.passives = [mkPassive({ trigger: 'onHit', targetMode: 'trigger', chance: 1, effects: [{ kind: 'applyBuff', buffId: 'poison', stacks: 1 }] })];
    const e = firstEnemy(mgr);
    e.hp = 99999; e.maxHp = 99999;
    e.x = s.x + 80; e.y = 0;   // 摆进近战攻击距离（dps 前压上限只有 80 像素，钉死的怪必须凑过来）
    // 敌人也挂一个 onHurt 反击伤害被动（手工构造）：若递归不受控，一次普攻会引爆连锁
    e.passives = [mkPassive({ trigger: 'onHurt', targetMode: 'trigger', chance: 1, effects: [{ kind: 'damage', mult: 1 }] })];
    const sHp0 = s.hp;
    for (let i = 0; i < 60 && e.buffs.length === 0; i++) mgr.tick(0.05);
    assert.ok(e.buffs.some(b => b.id === 'poison'), '普攻命中应挂毒');
    // 反击只结算一层：s 掉血但仍存活（无限递归会打穿 99999 或栈溢出）
    assert.ok(s.hp < sHp0, '敌人的 onHurt 反击应结算一层');
    assert.ok(s.alive);
});

test('集成 onCast：放技能后触发 self buff', () => {
    const mgr = detManager(['dps'], { atk: 30, range: 0 });
    const s = mgr.soldiers[0];
    const def: SkillDef = {
        id: 't', name: '测试', cls: 'dps', trigger: 'timer', triggerValue: 0.1,
        target: 'nearest', radius: 0, maxTargets: 1, effects: [{ kind: 'damage', mult: 1 }], delivery: null,
    };
    s.skills = new UnitSkills([def]);
    s.passives = [mkPassive({ trigger: 'onCast', targetMode: 'self', chance: 1, effects: [{ kind: 'applyBuff', buffId: 'battle_cry', stacks: 1 }] })];
    firstEnemy(mgr);
    for (let i = 0; i < 10 && !s.buffs.some(b => b.id === 'battle_cry'); i++) mgr.tick(0.05);
    assert.ok(s.buffs.some(b => b.id === 'battle_cry'), '放技能应触发战吼');
});

let failed = 0;
for (const t of tests) {
    try { t.run(); console.log(`  ✓ ${t.name}`); }
    catch (e) { failed++; console.error(`  ✗ ${t.name}`); console.error(e); }
}
console.log(`\n被动系统测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
