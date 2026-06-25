// 游戏内实时调参面板（ConfigPanel）—— 临时手感调试工具
// 预览（浏览器）时在屏幕右上叠一个 HTML 面板：拖滑块/填数字，战斗实时生效。
// 定位：只负责临时调整。调好后点「导出 JSON」把数值复制出来，后续由 Excel 统一管理。
// 注意：用的是 HTML DOM，只在网页预览里出现；微信小游戏构建里不会显示（也不该带它上线）。

import { BattleConfig } from '../config/BattleConfig';

// 一个可调字段的描述
interface Field {
    group: string;
    label: string;
    min: number;
    max: number;
    step: number;
    get: () => number;
    set: (v: number) => void;
}

function buildFields(): Field[] {
    const C = BattleConfig;
    const f = (group: string, label: string, min: number, max: number, step: number,
               get: () => number, set: (v: number) => void): Field =>
        ({ group, label, min, max, step, get, set });

    const fields: Field[] = [
        // 坦克
        f('🛡 坦克', '血量', 50, 1200, 10, () => C.classes.tank.hp, v => C.classes.tank.hp = v),
        f('🛡 坦克', '伤害', 1, 120, 1, () => C.classes.tank.damage, v => C.classes.tank.damage = v),
        f('🛡 坦克', '攻击间隔', 0.1, 2, 0.05, () => C.classes.tank.fireInterval, v => C.classes.tank.fireInterval = v),
        f('🛡 坦克', '射程', 30, 300, 5, () => C.classes.tank.range, v => C.classes.tank.range = v),
        f('🛡 坦克', '移速', 0, 600, 20, () => C.classes.tank.moveSpeed, v => C.classes.tank.moveSpeed = v),
        f('🛡 坦克', '前压上限', 0, 400, 10, () => C.classes.tank.advanceLimit, v => C.classes.tank.advanceLimit = v),
        // 输出
        f('🔫 输出', '血量', 20, 600, 10, () => C.classes.dps.hp, v => C.classes.dps.hp = v),
        f('🔫 输出', '伤害', 1, 120, 1, () => C.classes.dps.damage, v => C.classes.dps.damage = v),
        f('🔫 输出', '攻击间隔', 0.05, 2, 0.02, () => C.classes.dps.fireInterval, v => C.classes.dps.fireInterval = v),
        f('🔫 输出', '射程', 100, 900, 10, () => C.classes.dps.range, v => C.classes.dps.range = v),
        // 治疗
        f('💚 治疗', '血量', 20, 600, 10, () => C.classes.healer.hp, v => C.classes.healer.hp = v),
        f('💚 治疗', '每秒治疗', 0, 80, 2, () => C.classes.healer.healPerSec, v => C.classes.healer.healPerSec = v),
        // 敌人
        f('👾 敌人', '移速', 20, 320, 10, () => C.enemy.speed, v => C.enemy.speed = v),
        f('👾 敌人', '伤害', 1, 120, 1, () => C.enemy.damage, v => C.enemy.damage = v),
        f('👾 敌人', '攻击间隔', 0.2, 3, 0.1, () => C.enemy.attackInterval, v => C.enemy.attackInterval = v),
        f('👾 敌人', '停靠距离', 60, 320, 10, () => C.enemy.contactGap, v => C.enemy.contactGap = v),
    ];

    // 波次（按当前波数动态生成）
    C.waves.forEach((w, i) => {
        const g = `🌊 第${i + 1}波`;
        fields.push(f(g, '数量', 1, 40, 1, () => C.waves[i].count, v => C.waves[i].count = v));
        fields.push(f(g, '每只血量', 20, 1000, 10, () => C.waves[i].hp, v => C.waves[i].hp = v));
        fields.push(f(g, '出怪间隔', 0.1, 2, 0.05, () => C.waves[i].interval, v => C.waves[i].interval = v));
    });
    fields.push(f('⏱ 节奏', '波次间隔', 0, 6, 0.5, () => C.waveGap, v => C.waveGap = v));

    return fields;
}

const PANEL_ID = 'battle-config-panel';

// 挂载面板。onRestart：点「重开战斗」时调用（让血量/站位等开局读取的值重新生效）。
export function mountConfigPanel(onRestart: () => void) {
    const doc: any = (globalThis as any).document;
    if (!doc) return; // 非网页环境（如微信小游戏）直接跳过

    // 避免重复挂载
    const old = doc.getElementById(PANEL_ID);
    if (old) old.remove();

    const panel = doc.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
        'position:fixed', 'top:8px', 'right:8px', 'width:264px', 'max-height:92vh',
        'overflow-y:auto', 'background:rgba(20,22,28,0.92)', 'color:#eee',
        'font:12px/1.4 system-ui,Arial', 'padding:8px', 'border-radius:8px',
        'z-index:99999', 'box-shadow:0 4px 16px rgba(0,0,0,0.5)', 'user-select:none',
    ].join(';');

    // 标题栏
    const head = doc.createElement('div');
    head.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';
    const title = doc.createElement('b');
    title.textContent = '⚙ 战斗调参';
    title.style.cssText = 'flex:1;font-size:13px';
    head.appendChild(title);

    const body = doc.createElement('div');

    const mkBtn = (text: string, bg: string, on: () => void) => {
        const b = doc.createElement('button');
        b.textContent = text;
        b.style.cssText = `background:${bg};color:#fff;border:0;border-radius:5px;padding:3px 7px;cursor:pointer;font-size:11px`;
        b.onclick = on;
        return b;
    };

    // 折叠
    let collapsed = false;
    const toggle = mkBtn('—', '#444', () => {
        collapsed = !collapsed;
        body.style.display = collapsed ? 'none' : 'block';
        toggle.textContent = collapsed ? '+' : '—';
    });
    head.appendChild(toggle);
    panel.appendChild(head);
    panel.appendChild(body);

    // 字段分组渲染
    const fields = buildFields();
    let curGroup = '';
    for (const fd of fields) {
        if (fd.group !== curGroup) {
            curGroup = fd.group;
            const gh = doc.createElement('div');
            gh.textContent = fd.group;
            gh.style.cssText = 'margin:8px 0 3px;font-weight:bold;color:#7cf;border-bottom:1px solid #333;padding-bottom:2px';
            body.appendChild(gh);
        }

        const row = doc.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:5px;margin:2px 0';

        const lab = doc.createElement('span');
        lab.textContent = fd.label;
        lab.style.cssText = 'width:64px;flex:none;color:#bbb';

        const range = doc.createElement('input');
        range.type = 'range';
        range.min = String(fd.min); range.max = String(fd.max); range.step = String(fd.step);
        range.value = String(fd.get());
        range.style.cssText = 'flex:1;min-width:0';

        const num = doc.createElement('input');
        num.type = 'number';
        num.min = String(fd.min); num.max = String(fd.max); num.step = String(fd.step);
        num.value = String(fd.get());
        num.style.cssText = 'width:52px;flex:none;background:#2a2d36;color:#fff;border:1px solid #444;border-radius:4px;padding:1px 3px';

        const apply = (v: number) => {
            fd.set(v);
            range.value = String(v);
            num.value = String(v);
        };
        range.oninput = () => apply(parseFloat(range.value));
        num.oninput = () => apply(parseFloat(num.value));

        row.appendChild(lab);
        row.appendChild(range);
        row.appendChild(num);
        body.appendChild(row);
    }

    // 底部按钮：重开 / 导出
    const footer = doc.createElement('div');
    footer.style.cssText = 'display:flex;gap:6px;margin-top:10px';
    footer.appendChild(mkBtn('🔄 重开战斗', '#2e7d32', () => onRestart()));
    footer.appendChild(mkBtn('📋 导出 JSON', '#1565c0', () => exportConfig(doc)));
    body.appendChild(footer);

    const hint = doc.createElement('div');
    hint.textContent = '改完拖滑块即时生效；改血量/站位需点「重开战斗」。调好点导出。';
    hint.style.cssText = 'margin-top:6px;color:#888;font-size:10px';
    body.appendChild(hint);

    doc.body.appendChild(panel);
}

// 导出当前配置为 JSON：复制到剪贴板 + 打印控制台 + 弹出可复制文本框
function exportConfig(doc: any) {
    const json = JSON.stringify({
        classes: BattleConfig.classes,
        roster: BattleConfig.roster,
        layout: BattleConfig.layout,
        bullet: BattleConfig.bullet,
        enemy: BattleConfig.enemy,
        waves: BattleConfig.waves,
        waveGap: BattleConfig.waveGap,
    }, null, 2);

    console.log('[战斗配置导出]\n' + json);
    const nav: any = (globalThis as any).navigator;
    if (nav?.clipboard?.writeText) nav.clipboard.writeText(json);

    // 弹一个浮层文本框，方便手动全选复制
    const old = doc.getElementById('battle-config-export');
    if (old) old.remove();
    const box = doc.createElement('div');
    box.id = 'battle-config-export';
    box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center';
    const ta = doc.createElement('textarea');
    ta.value = json;
    ta.style.cssText = 'width:70%;height:70%;font:12px monospace;padding:10px;border-radius:8px';
    const close = doc.createElement('button');
    close.textContent = '关闭（已复制到剪贴板）';
    close.style.cssText = 'position:fixed;top:16px;right:16px;padding:6px 12px;font-size:13px;cursor:pointer';
    close.onclick = () => box.remove();
    box.appendChild(ta);
    box.appendChild(close);
    box.onclick = (e: any) => { if (e.target === box) box.remove(); };
    doc.body.appendChild(box);
    ta.focus();
    ta.select();
}
