// 装备 effective-stats 单测（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { BattleConfig, CombatStats } from '../assets/scripts/config/BattleConfig';
import { calcEquipItemStats, EquipConfig } from '../assets/scripts/config/EquipConfig';
import { InlayConfig } from '../assets/scripts/inlay/InlayConfig';
import { calcEffectiveStats, buildEffectiveStatsMap } from '../assets/scripts/combat/EffectiveStats';
import { EquipItem, randomItem } from '../assets/scripts/inventory/EquipDefs';
import { itemInlayStats } from '../assets/scripts/inlay/InlayStats';
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
        moveSpeed: 200,
        skillHaste: 0,
        basicDmgBonus: 0,
        skillDmgBonus: 0,
        singleDmgBonus: 0,
        aoeDmgBonus: 0,
    };
}

test('calcEquipItemStats：按部位基础值 × 品质倍率生成属性（基数读配置，随 balance:derive 变）', () => {
    const st = calcEquipItemStats('weapon', 'rare', () => 0.5);
    const baseAtk = EquipConfig.slotBonuses.weapon.atk!;
    const baseCrit = EquipConfig.slotBonuses.weapon.critRate!;
    const mult = EquipConfig.qualities.rare.multiplier;
    assert.equal(st.atk, Math.round(baseAtk * mult));
    assert.equal(st.critRate, Number((baseCrit * mult).toFixed(4)));
});

test('calcEquipItemStats：同部位同品质也会因 roll/附加词条不同而不同', () => {
    const low = calcEquipItemStats('weapon', 'epic', () => 0.1);
    const high = calcEquipItemStats('weapon', 'epic', () => 0.9);
    assert.notDeepEqual(low, high);
    assert.ok(Object.keys(low).length >= 4, '史诗至少有基础属性 + 2 条附加词条');
    assert.ok(Object.keys(high).length >= 4, '史诗至少有基础属性 + 2 条附加词条');
});

test('calcEquipItemStats：等级系数与品质倍率独立叠乘，不传 level 时等价于 1 级', () => {
    const noLevelArg = calcEquipItemStats('weapon', 'common', () => 0.5);
    const lvl1 = calcEquipItemStats('weapon', 'common', () => 0.5, 1);
    const lvl30 = calcEquipItemStats('weapon', 'common', () => 0.5, 30);
    const baseAtk = EquipConfig.slotBonuses.weapon.atk!;
    assert.equal(noLevelArg.atk, lvl1.atk, '不传 level 应等价于 1 级');
    assert.equal(lvl1.atk, Math.round(baseAtk));                      // 基数 × 1.0品质 × 1.0等级 × 1.0roll中值
    assert.equal(lvl30.atk, Math.round(baseAtk * (1 + 29 * 0.03)));   // × 1.87 等级系数
    assert.ok(lvl30.atk > lvl1.atk, '等级系数应让高等级装备属性更高');
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

test('buildEffectiveStatsMap：传 levels 时按等级系数放大 hp/atk 再叠加装备', () => {
    const base = BattleConfig.stats.dps;
    const map = buildEffectiveStatsMap(undefined, { dps: 10 });
    // statGrowthPerLevel 从配置读取，此处只验证「有放大」而非精确系数（系数值由 charLevelCoef 单测覆盖）
    assert.ok(map.dps!.hp > base.hp, `10级 hp(${map.dps!.hp}) 应大于1级基础(${base.hp})`);
    assert.ok(map.dps!.atk > base.atk, `10级 atk(${map.dps!.atk}) 应大于1级基础(${base.atk})`);
});

test('buildEffectiveStatsMap：不传 levels 时与不传该参数时行为一致（向后兼容）', () => {
    const withUndefined = buildEffectiveStatsMap(undefined);
    const withEmptyLevels = buildEffectiveStatsMap(undefined, {});
    assert.deepEqual(withUndefined, withEmptyLevels);
});

test('双层公式：面板 = (白板+固定)×(1+百分比)，等级百分比乘全池且覆盖 def', () => {
    const base = { ...baseStats(), hp: 1000, atk: 100, def: 50 };
    const item: EquipItem = {
        id: 't_pct', slot: 'weapon', name: 'x', quality: 'common', level: 1,
        stats: { atk: 40, atkPct: 0.10 },
    };
    const out = calcEffectiveStats(base, [item], 0.20);   // levelPct=20%
    assert.equal(out.atk, Math.round((100 + 40) * (1 + 0.10 + 0.20)), 'atk 双层应 (100+40)×1.30=182');
    assert.equal(out.hp, Math.round(1000 * 1.20), 'hp 吃等级百分比');
    assert.equal(out.def, Math.round(50 * 1.20), 'def 也吃等级百分比（2026-07-11 双层公式新行为）');
});

test('双层公式：moveSpeed 双形态 + 新二级属性平铺', () => {
    const base = baseStats();   // moveSpeed 200
    const item: EquipItem = {
        id: 't_ms', slot: 'shoes', name: 'x', quality: 'common', level: 1,
        stats: { moveSpeed: 30, moveSpeedPct: 0.10, skillHaste: 0.15 },
    };
    const out = calcEffectiveStats(base, [item]);
    assert.equal(out.moveSpeed, Math.round((200 + 30) * 1.10), '移速 (200+30)×1.10=253');
    assert.ok(Math.abs(out.skillHaste - 0.15) < 1e-9, '技能急速走平铺');
});

test('itemInlayStats：汇总宝石(gemStatValue)+铭文({stat,value})加成', () => {
    const item = {
        id: 'g', slot: 'weapon', name: '剑', quality: 'legend',
        gemSockets: [{ type: 'atk', level: 2 }, { type: 'hp', level: 1 }, null],
        inscriptions: [{ stat: 'atk', value: 15 }, null],
    };
    const s = itemInlayStats(item as any);
    const gemAtkBase = InlayConfig.gems.atk.baseValue;   // 基值随 balance:derive 变，读配置断言
    const gemHpBase = InlayConfig.gems.hp.baseValue;
    const ratio = InlayConfig.gems.atk.levelRatio ?? 1;
    assert.equal(s.atk, Math.round(gemAtkBase * ratio) + 15);   // 宝石 atk Lv.2 = 基值×ratio + 铭文 atk 15
    assert.equal(s.hp, Math.round(gemHpBase));                  // 宝石 hp Lv.1 = 基值×ratio^0
});

test('itemInlayStats：无镶嵌装备返回空加成', () => {
    const s = itemInlayStats({ id: 'p', slot: 'shoes', name: '鞋', quality: 'common' } as any);
    assert.deepEqual(s, {});
});

test('calcEffectiveStats：叠加装备词条 + 镶嵌加成', () => {
    const base = baseStats();
    const item = {
        id: 'w', slot: 'weapon', name: '剑', quality: 'legend',
        stats: { atk: 100 },
        gemSockets: [{ type: 'atk', level: 1 }, null, null],
        inscriptions: [null, null],
    };
    const out = calcEffectiveStats(base, [item as any]);
    const gemAtkL1 = Math.round(InlayConfig.gems.atk.baseValue);   // Lv.1 = 基值（读配置，随 derive 变）
    assert.equal(out.atk, base.atk + 100 + gemAtkL1);   // 基础10 + 词条100 + 宝石atk Lv.1
});

test('extraStats（心法）：平铺键累加、百分比键进双层公式', () => {
    const base = baseStats();
    const noTalent = calcEffectiveStats(base, []);
    const withTalent = calcEffectiveStats(baseStats(), [], 0, { atk: 10, atkPct: 0.10, critRate: 0.05 });
    assert.equal(withTalent.atk, Math.round((base.atk + 10) * 1.10));
    assert.ok(Math.abs(withTalent.critRate - (noTalent.critRate + 0.05)) < 1e-9);
});

test('extraStats 缺省：行为与旧签名逐位一致', () => {
    assert.deepEqual(calcEffectiveStats(baseStats(), []), calcEffectiveStats(baseStats(), [], 0, undefined));
});

test('buildEffectiveStatsMap：extraStats 叠给每个职业', () => {
    const plain = buildEffectiveStatsMap(undefined, {});
    const boosted = buildEffectiveStatsMap(undefined, {}, { hpPct: 0.10 });
    for (const cls of ['tank', 'dps', 'healer'] as const) {
        assert.equal(boosted[cls]!.hp, Math.round(plain[cls]!.hp * 1.10), `${cls} hp 应放大 10%`);
    }
});

console.log(`\n有效属性测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
