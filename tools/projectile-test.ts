// Projectile 弹道测试（纯逻辑，tsx 运行）：直线/穿透/抛物/去重/越界/护栏。
import assert from 'node:assert/strict';
import { BattleManager, type Projectile } from '../assets/scripts/combat/BattleManager';
import type { CombatUnit } from '../assets/scripts/combat/CombatUnit';
import { BattleConfig, type CombatStats } from '../assets/scripts/config/BattleConfig';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }

function mkStats(p: Partial<CombatStats>): CombatStats {
    return { ...BattleConfig.stats.dps, critRate: 0, dodgeRate: 0, blockRate: 0, dmgBonus: 0, dmgReduce: 0, ...p };
}
// range=0 的 dps 不普攻不放技能（timer 8s 起），隔离被测路径
function mkQuietManager(): BattleManager {
    return new BattleManager(470, 836, 0, { dps: mkStats({ atk: 50, range: 0, hp: 99999 }) }, ['dps']);
}
function firstEnemy(mgr: BattleManager): CombatUnit {
    for (let i = 0; i < 100 && mgr.enemies.length === 0; i++) mgr.tick(0.05);
    assert.ok(mgr.enemies.length > 0, '应已刷出敌人');
    const e = mgr.enemies[0];
    // 钉住消除移动干扰 + 清零闪避/格挡保证伤害断言确定性（换引用，不污染全局配置）
    e.baseStats = { ...e.baseStats, moveSpeed: 0, dodgeRate: 0, blockRate: 0 };
    e.stats = e.baseStats;
    return e;
}
function mkProjectile(p: Partial<Projectile>): Projectile {
    return {
        x: 0, y: 0, vx: 0, vy: 0,
        stats: mkStats({ atk: 50 }),
        effects: [{ kind: 'damage', mult: 1 }],
        pierce: 0, gravity: 0, hitIds: [],
        owner: null, isBasicAttack: false,
        alive: true,
        ...p,
    };
}

test('直线命中：飞向敌人，命中扣血一次后弹体消亡', () => {
    const mgr = mkQuietManager();
    const e = firstEnemy(mgr);
    const hp0 = e.hp;
    mgr.projectiles.push(mkProjectile({ x: e.x - 200, y: e.y, vx: 900, vy: 0 }));
    for (let i = 0; i < 20; i++) mgr.tick(0.02);
    const expected = Math.max(1, Math.round(Math.max(50 - e.stats.def, 50 * BattleConfig.combat.minDamageRate)));
    assert.equal(e.hp, hp0 - expected);
    assert.equal(mgr.projectiles.length, 0, '命中后应被压缩清理');
});

test('穿透：pierce=2 连续命中三只叠位敌人各一次', () => {
    const mgr = mkQuietManager();
    const e0 = firstEnemy(mgr);
    for (let i = 0; i < 200 && mgr.enemies.length < 3; i++) mgr.tick(0.05);
    assert.ok(mgr.enemies.length >= 3, '应已刷出三只敌人');
    const es = mgr.enemies.slice(0, 3);
    const hps: number[] = [];
    es.forEach((e, i) => {
        e.baseStats = { ...e.baseStats, moveSpeed: 0, dodgeRate: 0, blockRate: 0 };
        e.stats = e.baseStats;
        e.x = 100 + i * 80; e.y = 0; e.hp = 99999; e.maxHp = 99999; hps.push(e.hp);
    });
    void e0;
    mgr.projectiles.push(mkProjectile({ x: 0, y: 0, vx: 900, vy: 0, pierce: 2 }));
    for (let i = 0; i < 40; i++) mgr.tick(0.02);
    es.forEach((e, i) => assert.ok(e.hp < hps[i], `第 ${i + 1} 只应被穿透命中`));
    assert.equal(mgr.projectiles.length, 0, '穿透耗尽后消亡');
});

test('穿透去重：hitIds 防同一敌人二次结算', () => {
    const mgr = mkQuietManager();
    const e = firstEnemy(mgr);
    e.hp = 99999; e.maxHp = 99999;
    const hp0 = e.hp;
    // pierce 很大但只有一只敌人：只结算一次，然后飞出屏幕
    mgr.projectiles.push(mkProjectile({ x: e.x - 100, y: e.y, vx: 2000, vy: 0, pierce: 99 }));
    for (let i = 0; i < 40; i++) mgr.tick(0.02);
    const expected = Math.max(1, Math.round(Math.max(50 - e.stats.def, 50 * BattleConfig.combat.minDamageRate)));
    assert.equal(e.hp, hp0 - expected, '同一敌人只结算一次');
    assert.equal(mgr.projectiles.length, 0, '飞出边界后清理');
});

test('抛物：y 先升后降且最终命中', () => {
    const mgr = mkQuietManager();
    const e = firstEnemy(mgr);
    e.x = 300; e.y = 0; e.hp = 99999; e.maxHp = 99999;
    const hp0 = e.hp;
    // 手动按瞄准公式构造：t = dist/speed; vy0 = dy/t + 0.5*g*t
    const fromX = -100, fromY = 0, speed = 500, g = 1400;
    const dx = e.x - fromX, dy = e.y - fromY;
    const dist = Math.abs(dx), t = dist / speed;
    const p = mkProjectile({ x: fromX, y: fromY, vx: dx / t, vy: dy / t + 0.5 * g * t, gravity: g });
    mgr.projectiles.push(p);
    let peaked = false, rose = false;
    for (let i = 0; i < 100 && e.hp === hp0; i++) {
        const yBefore = p.y;
        mgr.tick(0.02);
        if (p.y > yBefore + 0.01) rose = true;
        if (rose && p.y < yBefore) peaked = true;
    }
    assert.ok(rose, '弹体应先上升');
    assert.ok(peaked, '弹体应过顶点下落');
    assert.ok(e.hp < hp0, '抛物弹最终命中');
});

test('护栏：弹道数量封顶 64', () => {
    const mgr = mkQuietManager();
    firstEnemy(mgr);
    for (let i = 0; i < 100; i++) mgr.projectiles.push(mkProjectile({ x: -400, y: 400, vx: 0, vy: 1 }));
    // 直接塞满超过上限（模拟异常规模），再经一次远程普攻验证不再增长：
    // 用公开路径：把 dps 改成有射程并等它开火——不增长即护栏生效
    const before = mgr.projectiles.length;
    assert.ok(before >= 64);
    mgr.soldiers[0].baseStats.range = 2000;   // stats===baseStats 同一引用，直接生效
    for (let i = 0; i < 30; i++) mgr.tick(0.05);
    assert.ok(mgr.projectiles.length <= before, '达到上限后普攻不再生成新弹体');
});

let failed = 0;
for (const t of tests) {
    try { t.run(); console.log(`  ✓ ${t.name}`); }
    catch (e) { failed++; console.error(`  ✗ ${t.name}`); console.error(e); }
}
console.log(`\n弹道测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
