// 技能系统测试（纯逻辑，tsx 运行）。
import assert from 'node:assert/strict';
import { UnitSkills, selectTargets, unitSkillsForClass, type SkillTargetable } from '../assets/scripts/combat/SkillRuntime';
import type { SkillDef } from '../assets/scripts/config/SkillConfig';
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { BattleConfig } from '../assets/scripts/config/BattleConfig';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }

function mkDef(partial: Partial<SkillDef>): SkillDef {
    return {
        id: 'test', name: '测试', cls: 'dps',
        trigger: 'timer', triggerValue: 5,
        target: 'single', radius: 0, maxTargets: 0, dmgMult: 1,
        ...partial,
    };
}

function mkEnemy(x: number, y: number, alive = true): SkillTargetable { return { x, y, alive }; }

test('timer 技能：计时到点且有目标才释放，释放后重置', () => {
    const sk = new UnitSkills([mkDef({ trigger: 'timer', triggerValue: 5, target: 'single' })]);
    const target = mkEnemy(10, 0);
    sk.tick(4.9);
    assert.equal(sk.collectCasts(0, 0, [target], target).length, 0);
    sk.tick(0.2);
    const casts = sk.collectCasts(0, 0, [target], target);
    assert.equal(casts.length, 1);
    assert.deepEqual(casts[0].targets, [target]);
    assert.equal(sk.collectCasts(0, 0, [target], target).length, 0);
    assert.ok(sk.progress(0) < 1);
});

test('attackCount 技能：攒满普攻次数触发并重置', () => {
    const sk = new UnitSkills([mkDef({ trigger: 'attackCount', triggerValue: 3 })]);
    const t = mkEnemy(0, 0);
    sk.onBasicAttack(); sk.onBasicAttack();
    assert.equal(sk.collectCasts(0, 0, [t], t).length, 0);
    sk.onBasicAttack();
    assert.equal(sk.collectCasts(0, 0, [t], t).length, 1);
    assert.equal(sk.progress(0), 0);
});

test('无目标时保留待放，出现目标后释放一次且只一次', () => {
    const sk = new UnitSkills([mkDef({ trigger: 'timer', triggerValue: 1 })]);
    sk.tick(3);
    assert.equal(sk.collectCasts(0, 0, [], null).length, 0);
    assert.equal(sk.progress(0), 1);
    const t = mkEnemy(0, 0);
    assert.equal(sk.collectCasts(0, 0, [t], t).length, 1);
    assert.equal(sk.collectCasts(0, 0, [t], t).length, 0);
});

test('selectTargets：aoe 只命中半径内活敌', () => {
    const def = mkDef({ target: 'aoe', radius: 100 });
    const near = mkEnemy(50, 0), far = mkEnemy(500, 0), dead = mkEnemy(10, 0, false);
    assert.deepEqual(selectTargets(def, 0, 0, [near, far, dead], null), [near]);
});

test('selectTargets：nearest 按距离升序取前 N 个', () => {
    const def = mkDef({ target: 'nearest', maxTargets: 2 });
    const a = mkEnemy(10, 0), b = mkEnemy(20, 0), c = mkEnemy(30, 0);
    assert.deepEqual(selectTargets(def, 0, 0, [c, a, b], null), [a, b]);
});

test('selectTargets：single 只打当前目标，目标死亡/为空则不选', () => {
    const def = mkDef({ target: 'single' });
    const t = mkEnemy(10, 0);
    assert.deepEqual(selectTargets(def, 0, 0, [t], t), [t]);
    assert.deepEqual(selectTargets(def, 0, 0, [t], mkEnemy(0, 0, false)), []);
    assert.deepEqual(selectTargets(def, 0, 0, [t], null), []);
});

test('unitSkillsForClass(dps) 装载配置中的 3 个技能', () => {
    const sk = unitSkillsForClass('dps');
    assert.equal(sk.count, 3);
    assert.ok(sk.defAt(0));
});

let failed = 0;
for (const t of tests) {
    try {
        t.run();
        console.log(`  ✓ ${t.name}`);
    } catch (e) {
        failed++;
        console.error(`  ✗ ${t.name}`);
        console.error(e);
    }
}

console.log(`\n技能测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
