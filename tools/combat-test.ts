import assert from 'node:assert/strict';
import { BattleManager, type BattleEvent, type EnemyKilledEvent } from '../assets/scripts/combat/BattleManager';
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
    const classes = mgr.soldiers.map(s => s.cls).slice().sort();
    assert.deepEqual(classes, ['dps', 'tank']);
});

test('BattleManager：缺省 roster 回退配置默认（至少 1 名士兵）', () => {
    const mgr = new BattleManager(470, 836, 0, {});
    assert.ok(mgr.soldiers.length >= 1, '缺省应按配置 roster 布阵');
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
