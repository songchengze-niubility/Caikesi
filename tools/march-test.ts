// 行军推进状态机测试（纯逻辑，tsx 运行）。
// 覆盖：清波→marching 时长计算（最慢移速/减速 Buff 影响）→清弹道场地→刷下一波→末波直接胜利→事件。
import assert from 'node:assert/strict';
import { BattleManager } from '../assets/scripts/combat/BattleManager';
import { applyEffect } from '../assets/scripts/combat/Effects';
import { BattleConfig, type CombatStats } from '../assets/scripts/config/BattleConfig';

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void) { tests.push({ name, run }); }

// 高攻速高攻队伍：快速清波（技能空载，range 大保证normal attacks清怪）
function mkSweeper(): BattleManager {
    const stats: CombatStats = {
        ...BattleConfig.stats.dps,
        hp: 99999, atk: 99999, range: 2000, attackSpeed: 20,
        critRate: 0, dodgeRate: 0, blockRate: 0, dmgBonus: 0, dmgReduce: 0,
        moveSpeed: 300,
    };
    return new BattleManager(470, 836, 0, { dps: stats }, ['dps']);
}
function clearCurrentWave(mgr: BattleManager, maxTicks = 4000): void {
    const start = mgr.waveIndex;
    for (let i = 0; i < maxTicks; i++) {
        mgr.tick(0.05);
        if (mgr.phase !== 'spawning' || mgr.waveIndex !== start) return;
    }
    assert.fail('清波超时');
}

test('清第 1 波后进入 marching，时长 = distance / 最慢移速', () => {
    const mgr = mkSweeper();
    clearCurrentWave(mgr);
    assert.equal(mgr.phase, 'marching');
    const d = BattleConfig.levels[0].waves[0].distance;
    assert.ok(d > 0, '第 1 波应配置了行军距离');
    assert.ok(Math.abs(mgr.marchDuration - d / 300) < 1e-6, `时长应为 ${d}/300`);
    assert.ok(mgr.marchRemaining > 0 && mgr.marchRemaining <= mgr.marchDuration);
});

test('行军首帧清空弹道与场地；走完时长后刷下一波', () => {
    const mgr = mkSweeper();
    clearCurrentWave(mgr);
    assert.equal(mgr.projectiles.length, 0, '行军应清弹道');
    assert.equal(mgr.zones.length, 0, '行军应清场地');
    const waveBefore = mgr.waveIndex;
    for (let i = 0; i < Math.ceil(mgr.marchDuration / 0.05) + 2; i++) mgr.tick(0.05);
    assert.equal(mgr.phase, 'spawning');
    assert.equal(mgr.waveIndex, waveBefore + 1);
    for (let i = 0; i < 20 && mgr.enemies.length === 0; i++) mgr.tick(0.05);
    assert.ok(mgr.enemies.length > 0, '下一波应刷出敌人');
});

test('减速 Buff 拉长行军：frost 后时长按减速值算', () => {
    const mgr = mkSweeper();
    const s = mgr.soldiers[0];
    applyEffect(s, s, { kind: 'applyBuff', buffId: 'frost', stacks: 1 }, (mgr as any)._effectHooks);
    assert.equal(s.stats.moveSpeed, 300 * 0.7, 'frost 应减速 30%');
    clearCurrentWave(mgr);
    // frost 时长 3s，可能在清波中过期——按清波后的实际移速断言
    const d = BattleConfig.levels[0].waves[0].distance;
    assert.ok(Math.abs(mgr.marchDuration - d / s.stats.moveSpeed) < 1e-6, '时长按当前最慢移速算');
});

test('行军期间士兵动作为 run，marchStarted/marchEnded 事件成对', () => {
    const mgr = mkSweeper();
    clearCurrentWave(mgr);
    mgr.tick(0.05);
    assert.equal(mgr.soldiers[0].action, 'run');
    for (let i = 0; i < Math.ceil(mgr.marchDuration / 0.05) + 2; i++) mgr.tick(0.05);
    const evts = mgr.drainEvents();
    const started = evts.filter(e => e.type === 'marchStarted');
    const ended = evts.filter(e => e.type === 'marchEnded');
    assert.equal(started.length, 1);
    assert.equal(ended.length, 1);
    assert.ok(started[0].type === 'marchStarted' && started[0].duration > 0 && started[0].distance > 0);
});

test('打完最后一波直接 won，不行军', () => {
    const mgr = mkSweeper();
    const totalWaves = BattleConfig.levels[0].waves.length;
    for (let i = 0; i < 20000 && mgr.phase !== 'won' && mgr.phase !== 'lost'; i++) mgr.tick(0.05);
    assert.equal(mgr.phase, 'won');
    assert.equal(mgr.waveIndex, totalWaves - 1);
});

let failed = 0;
for (const t of tests) {
    try { t.run(); console.log(`  ✓ ${t.name}`); }
    catch (e) { failed++; console.error(`  ✗ ${t.name}`); console.error(e); }
}
console.log(`\n行军测试：${tests.length - failed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
