import assert from 'node:assert/strict';
import { BattleManager, type BattleEvent, type EnemyKilledEvent } from '../assets/scripts/combat/BattleManager';
import { calcDamage } from '../assets/scripts/combat/CombatFormula';
import { createEnemyUnit } from '../assets/scripts/combat/CombatUnit';
import { BattleConfig } from '../assets/scripts/config/BattleConfig';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }

function monsterCount(levelIndex: number): number {
    const level = BattleConfig.levels[levelIndex];
    let total = 0;
    for (const wave of level.waves) {
        for (const spawn of wave.spawns) total += spawn.count;
    }
    return total;
}

test('BattleManager：每个敌人死亡只发一次 enemyKilled', () => {
    const mgr = new BattleManager(470, 836, 0, {
        dps: {
            ...BattleConfig.stats.dps,
            hp: 99999,
            atk: 99999,
            range: 2000,
            attackSpeed: 20,
            critRate: 0,
            dodgeRate: 0,
        },
    });
    const events: BattleEvent[] = [];
    for (let i = 0; i < 4000 && mgr.phase !== 'won'; i++) {
        mgr.tick(0.05);
        events.push(...mgr.drainEvents());
    }
    events.push(...mgr.drainEvents());

    const kills = events.filter((event): event is EnemyKilledEvent => event.type === 'enemyKilled');
    assert.equal(mgr.phase, 'won');
    assert.equal(kills.length, monsterCount(0));
    assert.equal(new Set(kills.map(event => event.killIndex)).size, kills.length);
});

test('BattleManager：最后一波最后一只怪标记为关底击杀', () => {
    const mgr = new BattleManager(470, 836, 0, {
        dps: {
            ...BattleConfig.stats.dps,
            hp: 99999,
            atk: 99999,
            range: 2000,
            attackSpeed: 20,
            critRate: 0,
            dodgeRate: 0,
        },
    });
    const events: BattleEvent[] = [];
    for (let i = 0; i < 4000 && mgr.phase !== 'won'; i++) {
        mgr.tick(0.05);
        events.push(...mgr.drainEvents());
    }
    events.push(...mgr.drainEvents());

    const kills = events.filter((event): event is EnemyKilledEvent => event.type === 'enemyKilled');
    const finals = kills.filter(event => event.isStageFinalKill);
    assert.equal(finals.length, 1);
    assert.equal(finals[0], kills[kills.length - 1]);
    assert.equal(finals[0].waveIndex, BattleConfig.levels[0].waves.length - 1);
});

test('BattleManager：roster 入参决定出战单位（覆盖配置默认）', () => {
    const mgr = new BattleManager(470, 836, 0, {}, ['tank', 'dps']);
    const classes = mgr.soldiers.map(s => s.key).slice().sort();
    assert.deepEqual(classes, ['dps', 'tank']);
});

test('BattleManager：缺省 roster 回退配置默认（至少 1 名士兵）', () => {
    const mgr = new BattleManager(470, 836, 0, {});
    assert.ok(mgr.soldiers.length >= 1, '缺省应按配置 roster 布阵');
});

test('CombatStats：18 维贯通——新增 5 维从 Excel 导出默认 0', () => {
    for (const cls of ['tank', 'dps', 'healer'] as const) {
        const st = BattleConfig.stats[cls];
        assert.equal(st.skillHaste, 0, `${cls}.skillHaste 默认应为 0`);
        assert.equal(st.basicDmgBonus, 0, `${cls}.basicDmgBonus 默认应为 0`);
        assert.equal(st.skillDmgBonus, 0, `${cls}.skillDmgBonus 默认应为 0`);
        assert.equal(st.singleDmgBonus, 0, `${cls}.singleDmgBonus 默认应为 0`);
        assert.equal(st.aoeDmgBonus, 0, `${cls}.aoeDmgBonus 默认应为 0`);
    }
    for (const key of Object.keys(BattleConfig.enemyTypes)) {
        assert.equal(BattleConfig.enemyTypes[key].stats.skillHaste, 0, `${key}.skillHaste 默认应为 0`);
        assert.equal(BattleConfig.enemyTypes[key].stats.aoeDmgBonus, 0, `${key}.aoeDmgBonus 默认应为 0`);
    }
});

test('enemyScale：关卡难度缩放——hp/atk/hp覆盖 全部 ×scale', () => {
    const base = BattleConfig.enemyTypes['zombie'].stats;
    const scaled = createEnemyUnit(1, 'zombie', undefined, 0, 0, 2)!;
    assert.equal(scaled.maxHp, Math.round(base.hp * 2), 'hp 应 ×2');
    assert.equal(scaled.stats.atk, Math.round(base.atk * 2), 'atk 应 ×2');
    const overridden = createEnemyUnit(2, 'zombie', 1000, 0, 0, 2)!;
    assert.equal(overridden.maxHp, 2000, 'hp 覆盖是"该行基准血量"，缩放照乘');
    assert.equal(overridden.stats.atk, Math.round(base.atk * 2), '覆盖 hp 不影响 atk 缩放');
    const plain = createEnemyUnit(3, 'zombie', undefined, 0, 0)!;
    assert.equal(plain.stats, base, 'scale=1 保持配置同引用（ConfigPanel 调参依赖）');
});

test('伤害标签：全伤害+来源+范围同乘区加算，三类不互乘', () => {
    // 零随机面板：闪避/暴击/格挡全 0，def 0 → 基础伤害恰为 atk
    const att = {
        ...BattleConfig.stats.dps, atk: 100, critRate: 0,
        dmgBonus: 0.1, basicDmgBonus: 0.2, skillDmgBonus: 0.3, singleDmgBonus: 0.05, aoeDmgBonus: 0.15,
    };
    const def = { ...BattleConfig.stats.tank, def: 0, dodgeRate: 0, blockRate: 0, dmgReduce: 0 };
    const basicSingle = calcDamage(att, def, { source: 'basic', scope: 'single' });
    assert.equal(basicSingle.damage, Math.round(100 * (1 + 0.1 + 0.2 + 0.05)), '普攻单体应 ×1.35');
    const skillAoe = calcDamage(att, def, { source: 'skill', scope: 'aoe' });
    assert.equal(skillAoe.damage, Math.round(100 * (1 + 0.1 + 0.3 + 0.15)), '技能群体应 ×1.55');
    const untagged = calcDamage(att, def);
    assert.equal(untagged.damage, Math.round(100 * 1.1), '无标签只吃全伤害（旧行为等价）');
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

console.log(`\n战斗事件测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
