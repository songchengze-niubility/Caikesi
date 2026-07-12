// RewardTypes 材料标签/构造器单测（tsx 运行）。
import * as assert from 'node:assert/strict';
import { MATERIAL_LABEL, gemMaterialId } from '../assets/scripts/services/RewardTypes';
import { gemTypes, gemMaxLevel } from '../assets/scripts/inlay/InlayConfig';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

test('gemMaterialId：拼出 gem_<type>_<level>', () => {
    assert.equal(gemMaterialId('atk', 2), 'gem_atk_2');
    assert.equal(gemMaterialId('crit', 4), 'gem_crit_4');
});

test('MATERIAL_LABEL：覆盖全部宝石键(类型×1~6) + rune_scroll + forge_stone', () => {
    for (const t of gemTypes()) {
        for (let lv = 1; lv <= gemMaxLevel(t); lv++) {
            const id = gemMaterialId(t, lv);
            assert.ok(MATERIAL_LABEL[id], `缺少标签: ${id}`);
        }
    }
    assert.equal(MATERIAL_LABEL['gem_atk_6'], '攻击宝石·Lv.6', '标签应覆盖到 6 级');
    assert.ok(MATERIAL_LABEL['rune_scroll']);
    assert.ok(MATERIAL_LABEL['forge_stone']);
});

test('talent_page：材料标签为秘笈残页', () => {
    assert.equal(MATERIAL_LABEL['talent_page'], '秘笈残页');
});

console.log(`\nRewardTypes：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
