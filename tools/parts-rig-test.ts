// PartsRig 纯逻辑单测（tsx）：参数表完整性 + 采样器循环/钳制/插值/归位/振幅红线。
// PartsRigConfig/PartsRigSampler 不依赖 cc，可直接 import。
import * as assert from 'node:assert/strict';
import {
    PartsRigActions, PartsRigBind, RIG_PART_IDS, RIG_ACTION_IDS, RIG_MAX_PART_OFFSET, RIG_PARENTS,
} from '../assets/scripts/art/PartsRigConfig';
import { sampleAction, IDENTITY_TRANSFORM } from '../assets/scripts/art/PartsRigSampler';

let pass = 0, fail = 0;
const tests: { name: string; fn: () => void | Promise<void> }[] = [];
function test(name: string, fn: () => void | Promise<void>) {
    tests.push({ name, fn });
}

function transformsClose(a: Record<string, number>, b: Record<string, number>, eps = 1e-6) {
    for (const k of Object.keys(a)) {
        assert.ok(Math.abs(a[k] - (b as any)[k]) < eps, `${k}: ${a[k]} != ${(b as any)[k]}`);
    }
}

test('参数表完整性：四动作四部件全有定义，时长>0，循环标志正确', () => {
    for (const action of RIG_ACTION_IDS) {
        const def = PartsRigActions[action];
        assert.ok(def, `缺动作 ${action}`);
        assert.ok(def.duration > 0, `${action} duration<=0`);
    }
    assert.equal(PartsRigActions.idle.loop, true);
    assert.equal(PartsRigActions.run.loop, true);
    assert.equal(PartsRigActions.attack.loop, false);
    assert.equal(PartsRigActions.death.loop, false);
    for (const part of RIG_PART_IDS) {
        assert.ok(PartsRigBind[part], `bind 缺部件 ${part}`);
    }
});

test('循环闭合：idle/run 在 t=0 与 t=duration 采样一致（无缝循环）', () => {
    for (const action of ['idle', 'run'] as const) {
        const def = PartsRigActions[action];
        const a = sampleAction(def, 0);
        const b = sampleAction(def, def.duration);
        for (const part of RIG_PART_IDS) {
            transformsClose(a.parts[part] as any, b.parts[part] as any);
        }
        transformsClose(a.root as any, b.root as any);
    }
});

test('非循环钳制：death 在 t>duration 后停在末姿态', () => {
    const def = PartsRigActions.death;
    const end = sampleAction(def, def.duration);
    const later = sampleAction(def, def.duration + 10);
    transformsClose(end.root as any, later.root as any);
    for (const part of RIG_PART_IDS) {
        transformsClose(end.parts[part] as any, later.parts[part] as any);
    }
});

test('未定义通道返回恒等 transform（x/y/rot=0，scale/opacity=1）', () => {
    // weapon 在 idle 里只动 rot，其余通道应为恒等；legFront 在 idle 里完全恒等
    const s = sampleAction(PartsRigActions.idle, 0.3);
    const w = s.parts.weapon;
    assert.equal(w.x, IDENTITY_TRANSFORM.x);
    assert.equal(w.y, IDENTITY_TRANSFORM.y);
    assert.equal(w.scaleX, IDENTITY_TRANSFORM.scaleX);
    assert.equal(w.opacity, IDENTITY_TRANSFORM.opacity);
    assert.deepEqual(s.parts.legFront, IDENTITY_TRANSFORM);
});

test('run 双腿交替：前后腿互为半周期相位（front(t)≈back(t+T/2)）', () => {
    const def = PartsRigActions.run;
    for (const t of [0, 0.1, 0.2, 0.3, 0.4]) {
        const a = sampleAction(def, def.duration * t).parts.legFront.rot;
        const b = sampleAction(def, def.duration * (t + 0.5)).parts.legBack.rot;
        assert.ok(Math.abs(a - b) < 3, `t=${t} 相位不对：front=${a.toFixed(1)} back(t+半周期)=${b.toFixed(1)}`);
    }
});

test('attack 结束归位：t=duration 时全部件回恒等（切回 idle 无跳变）', () => {
    const def = PartsRigActions.attack;
    const end = sampleAction(def, def.duration);
    for (const part of RIG_PART_IDS) {
        transformsClose(end.parts[part] as any, IDENTITY_TRANSFORM as any, 1e-3);
    }
    transformsClose(end.root as any, IDENTITY_TRANSFORM as any, 1e-3);
});

test('动作中段确实在动：attack 大臂主摆 >45°，臂+腕合计峰值 >80°', () => {
    const def = PartsRigActions.attack;
    let maxArm = 0, maxTotal = 0;
    for (let i = 0; i <= 20; i++) {
        const s = sampleAction(def, def.duration * i / 20);
        maxArm = Math.max(maxArm, Math.abs(s.parts.armFront.rot));
        maxTotal = Math.max(maxTotal, Math.abs(s.parts.armFront.rot + s.parts.weapon.rot));
    }
    assert.ok(maxArm > 45, `attack 大臂最大转角仅 ${maxArm}°`);
    assert.ok(maxTotal > 80, `attack 臂+腕合计峰值仅 ${maxTotal}°`);
});

test('振幅红线：idle/run 部件位移不超过遮挡余量（防拆件断口露馅）', () => {
    for (const action of ['idle', 'run'] as const) {
        const def = PartsRigActions[action];
        for (let i = 0; i <= 40; i++) {
            const s = sampleAction(def, def.duration * i / 40);
            for (const part of RIG_PART_IDS) {
                const p = s.parts[part];
                assert.ok(Math.abs(p.x) <= RIG_MAX_PART_OFFSET, `${action}.${part}.x=${p.x} 超余量`);
                assert.ok(Math.abs(p.y) <= RIG_MAX_PART_OFFSET, `${action}.${part}.y=${p.y} 超余量`);
            }
        }
    }
});

test('父子链完整且无环：每个部件沿 parent 走有限步到 root', () => {
    for (const part of RIG_PART_IDS) {
        let cur: string = part;
        let steps = 0;
        while (cur !== 'root') {
            cur = RIG_PARENTS[cur as keyof typeof RIG_PARENTS];
            assert.ok(cur, `${part} 的父链断裂`);
            steps++;
            assert.ok(steps <= RIG_PART_IDS.length, `${part} 父链成环`);
        }
    }
});

test('死亡淡出：death 末态 root 透明度降低且发生倾倒', () => {
    const def = PartsRigActions.death;
    const end = sampleAction(def, def.duration);
    assert.ok(end.root.opacity < 1, 'death 末态未淡出');
    assert.ok(Math.abs(end.root.rot) > 60, `death 末态倾倒角仅 ${end.root.rot}°`);
});

(async () => {
    for (const t of tests) {
        try { await t.fn(); pass++; console.log('  ✓ ' + t.name); }
        catch (e) { fail++; console.error('  ✗ ' + t.name + ' — ' + (e as Error).message); }
    }
    console.log(`\nPartsRig 测试：${pass} 通过，${fail} 失败`);
    process.exit(fail ? 1 : 0);
})();
