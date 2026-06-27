// 装备存储系统单测（纯逻辑，tsx 运行）。assets 下的 Model/Defs 不依赖 cc，故可直接 import。
import * as assert from 'node:assert/strict';
import { randomItem, SLOTS, QUALITIES, makeId } from '../assets/scripts/inventory/EquipDefs';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('randomItem 产出合法 slot/quality/name', () => {
    for (let i = 0; i < 50; i++) {
        const it = randomItem();
        assert.ok(SLOTS.includes(it.slot), 'slot 非法: ' + it.slot);
        assert.ok(QUALITIES.includes(it.quality), 'quality 非法: ' + it.quality);
        assert.ok(typeof it.name === 'string' && it.name.length > 0, 'name 为空');
    }
});

test('makeId 连续调用唯一', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(makeId());
    assert.equal(ids.size, 1000);
});

console.log(`\n装备测试：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
