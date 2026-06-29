// 装备 effective-stats 单测（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { BattleConfig, CombatStats } from '../assets/scripts/config/BattleConfig';
import { calcEquipItemStats } from '../assets/scripts/config/EquipConfig';
import { calcEffectiveStats, buildEffectiveStatsMap } from '../assets/scripts/combat/EffectiveStats';
import { EquipItem, randomItem } from '../assets/scripts/inventory/EquipDefs';
import { InventoryModel } from '../assets/scripts/inventory/InventoryModel';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

function baseStats(): CombatStats {
    return {
        hp: 100,
        atk: 10,
        def: 3,
        range: 80,
        attackSpeed: 1,
        critRate: 0.1,
        critDmg: 0.5,
        dodgeRate: 0,
        blockRate: 0,
        blockRatio: 0,
        dmgBonus: 0,
        dmgReduce: 0,
    };
}

test('calcEquipItemStats：按部位基础值 × 品质倍率生成属性', () => {
    const st = calcEquipItemStats('weapon', 'rare', () => 0.5);
    assert.equal(st.atk, 22);          // 12 × 1.8 = 21.6 → 四舍五入
    assert.equal(st.critRate, 0.036);  // 概率保留小数
});

test('calcEquipItemStats：同部位同品质也会因 roll/附加词条不同而不同', () => {
    const low = calcEquipItemStats('weapon', 'epic', () => 0.1);
    const high = calcEquipItemStats('weapon', 'epic', () => 0.9);
    assert.notDeepEqual(low, high);
    assert.ok(Object.keys(low).length >= 4, '史诗至少有基础属性 + 2 条附加词条');
    assert.ok(Object.keys(high).length >= 4, '史诗至少有基础属性 + 2 条附加词条');
});

test('randomItem：新掉落自带 stats', () => {
    for (let i = 0; i < 20; i++) {
        const it = randomItem();
        assert.ok(it.stats && Object.keys(it.stats).length > 0, '掉落缺少 stats');
    }
});

test('calcEffectiveStats：叠加多件装备且不改 base', () => {
    const base = baseStats();
    const items: EquipItem[] = [
        { id: 'w', slot: 'weapon', name: '剑', quality: 'common', stats: { atk: 5, critRate: 0.2 } },
        { id: 'h', slot: 'helmet', name: '盔', quality: 'fine', stats: { hp: 20, def: 2 } },
    ];
    const out = calcEffectiveStats(base, items);
    assert.equal(out.hp, 120);
    assert.equal(out.atk, 15);
    assert.equal(out.def, 5);
    assert.ok(Math.abs(out.critRate - 0.3) < 1e-9);
    assert.equal(base.hp, 100);
    assert.equal(base.atk, 10);
});

test('calcEffectiveStats：老存档无 stats 的装备按 0 处理', () => {
    const out = calcEffectiveStats(baseStats(), [
        { id: 'old', slot: 'weapon', name: '旧剑', quality: 'common' },
    ]);
    assert.deepEqual(out, baseStats());
});

test('calcEffectiveStats：概率/攻速/生命做安全钳制', () => {
    const out = calcEffectiveStats(baseStats(), [
        { id: 'x', slot: 'weapon', name: '测试', quality: 'legend', stats: { critRate: 9, dodgeRate: -1, attackSpeed: -5, hp: -999 } },
    ]);
    assert.equal(out.critRate, 1);
    assert.equal(out.dodgeRate, 0);
    assert.equal(out.attackSpeed, 0.01);
    assert.equal(out.hp, 1);
});

test('buildEffectiveStatsMap：把每个角色已穿装备接到 BattleConfig 基础属性', () => {
    const m = new InventoryModel();
    m.equipped.tank.weapon = { id: 'w', slot: 'weapon', name: '测试剑', quality: 'common', stats: { atk: 7 } };
    const map = buildEffectiveStatsMap(m.equipped);
    assert.equal(map.tank!.atk, BattleConfig.stats.tank.atk + 7);
    assert.equal(map.dps!.atk, BattleConfig.stats.dps.atk);
});

console.log(`\n有效属性测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
