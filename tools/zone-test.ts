// Zone 场地效果测试（纯逻辑，tsx 运行）：周期施加/半径筛选/到期/事件/护栏。
import assert from 'node:assert/strict';
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import type { CombatUnit } from '../assets/scripts/combat/CombatUnit';
import { BattleConfig, type CombatStats } from '../assets/scripts/config/BattleConfig';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }

function mkStats(p: Partial<CombatStats>): CombatStats {
    return { ...BattleConfig.stats.dps, critRate: 0, dodgeRate: 0, blockRate: 0, dmgBonus: 0, dmgReduce: 0, ...p };
}
function mkQuietManager(): BattleManager {
    return new BattleManager(470, 836, 0, { dps: mkStats({ atk: 50, range: 0, hp: 99999 }) }, ['dps']);
}
function pinEnemies(mgr: BattleManager, n: number): CombatUnit[] {
    for (let i = 0; i < 400 && mgr.enemies.length < n; i++) mgr.tick(0.05);
    assert.ok(mgr.enemies.length >= n, `应已刷出 ${n} 只敌人`);
    const es = mgr.enemies.slice(0, n);
    es.forEach((e, i) => { e.moveSpeed = 0; e.x = 100 + i * 40; e.y = 0; e.hp = 99999; e.maxHp = 99999; });
    return es;
}
const stats50 = () => mkStats({ atk: 50 });

test('毒池：周期对域内敌人走 calcDamage 口径跳伤，2.05s 两跳；半径外无伤', () => {
    const mgr = mkQuietManager();
    const [a, b] = pinEnemies(mgr, 2);
    b.x = 900;   // 半径外
    const hpA = a.hp, hpB = b.hp;
    (mgr as any)._spawnZone(a.x, a.y, { radius: 150, duration: 5, period: 1 }, [{ kind: 'damage', mult: 0.2 }], stats50());
    assert.equal(mgr.zones.length, 1);
    for (let i = 0; i < 41; i++) mgr.tick(0.05);   // 2.05s → 2 跳
    const perTick = Math.max(1, Math.round(Math.max(50 - a.stats.def, 50 * BattleConfig.combat.minDamageRate) * 0.2));
    assert.equal(a.hp, hpA - perTick * 2, '域内敌人应挨两跳');
    assert.equal(b.hp, hpB, '半径外敌人无伤');
});

test('到期：时长耗尽 zone 压缩清理，吐 zoneSpawned/zoneExpired 事件', () => {
    const mgr = mkQuietManager();
    pinEnemies(mgr, 1);
    mgr.drainEvents();
    (mgr as any)._spawnZone(0, 0, { radius: 100, duration: 0.5, period: 1 }, [{ kind: 'damage', mult: 0.2 }], stats50());
    for (let i = 0; i < 15; i++) mgr.tick(0.05);
    assert.equal(mgr.zones.length, 0, '到期应清理');
    const evts = mgr.drainEvents();
    assert.ok(evts.some(e => e.type === 'zoneSpawned'));
    assert.ok(evts.some(e => e.type === 'zoneExpired'));
});

test('护栏：zone 数量封顶 8', () => {
    const mgr = mkQuietManager();
    pinEnemies(mgr, 1);
    for (let i = 0; i < 12; i++) {
        (mgr as any)._spawnZone(i * 10, 0, { radius: 50, duration: 10, period: 1 }, [{ kind: 'damage', mult: 0.1 }], stats50());
    }
    assert.equal(mgr.zones.length, 8, '第 9 个起被护栏拒绝');
});

let failed = 0;
for (const t of tests) {
    try { t.run(); console.log(`  ✓ ${t.name}`); }
    catch (e) { failed++; console.error(`  ✗ ${t.name}`); console.error(e); }
}
console.log(`\n场地测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
