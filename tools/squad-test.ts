// 出战小队单测（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { SquadModel } from '../assets/scripts/squad/SquadModel';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('构造：超过 squadCap 截断到上限', () => {
    const m = new SquadModel(['tank', 'dps', 'healer'], 2);
    assert.deepEqual(m.deployedList(), ['tank', 'dps']);
});

test('deploy：满员时拒绝', () => {
    const m = new SquadModel(['tank', 'dps'], 2);
    assert.equal(m.deploy('healer'), false);
    assert.equal(m.isFull(), true);
    assert.deepEqual(m.deployedList(), ['tank', 'dps']);
});

test('deploy：未满且未上阵则加到末尾', () => {
    const m = new SquadModel(['tank'], 2);
    assert.equal(m.deploy('healer'), true);
    assert.deepEqual(m.deployedList(), ['tank', 'healer']);
});

test('deploy：重复上阵拒绝', () => {
    const m = new SquadModel(['tank'], 2);
    assert.equal(m.deploy('tank'), false);
});

test('undeploy：最后 1 人不可下阵', () => {
    const m = new SquadModel(['dps'], 2);
    assert.equal(m.undeploy('dps'), false);
    assert.deepEqual(m.deployedList(), ['dps']);
});

test('undeploy：多于 1 人可下阵', () => {
    const m = new SquadModel(['tank', 'dps'], 2);
    assert.equal(m.undeploy('tank'), true);
    assert.deepEqual(m.deployedList(), ['dps']);
});

test('move：重排前后顺序', () => {
    const m = new SquadModel(['tank', 'dps'], 2);
    assert.equal(m.move('dps', 0), true);
    assert.deepEqual(m.deployedList(), ['dps', 'tank']);
});

test('benchList：派生未出战列表', () => {
    const m = new SquadModel(['dps'], 2);
    assert.deepEqual(m.benchList().slice().sort(), ['healer', 'tank']);
});

test('deserialize：非法存档自愈（去重/过滤未知/截断上限）', () => {
    const m = SquadModel.deserialize({ deployed: ['tank', 'tank', 'bogus', 'healer', 'dps'] as any }, 2);
    assert.deepEqual(m.deployedList(), ['tank', 'healer']);
});

test('deserialize：空存档回落默认组合（1~squadCap 个合法角色）', () => {
    const m = SquadModel.deserialize(undefined, 2);
    const list = m.deployedList();
    assert.ok(list.length >= 1 && list.length <= 2, `默认组合长度应在 1~2，得到 ${list.length}`);
});

test('serialize/deserialize 往返一致', () => {
    const m = new SquadModel(['dps', 'tank'], 2);
    const back = SquadModel.deserialize(m.serialize(), 2);
    assert.deepEqual(back.deployedList(), ['dps', 'tank']);
});

console.log(`\nSquadModel：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
