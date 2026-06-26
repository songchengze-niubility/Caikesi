// 游戏内实时调参面板（ConfigPanel）—— 临时手感调试工具
// 预览（浏览器）时在屏幕右上叠一个 HTML 面板：拖滑块/填数字，战斗实时生效。
// 定位：只负责临时调整。调好后点「导出 JSON」把数值复制出来，后续由 Excel 统一管理。
// 注意：用的是 HTML DOM，只在网页预览里出现；微信小游戏构建里不会显示（也不该带它上线）。

import { BattleConfig, CombatStats, SoldierClass } from '../config/BattleConfig';

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

// 统一属性表的每个属性怎么显示（标签 + 滑块范围）。加新属性只在这里补一行。
const STAT_META: { key: keyof CombatStats; label: string; min: number; max: number; step: number }[] = [
    { key: 'hp',         label: '血量',     min: 0,   max: 1200, step: 10 },
    { key: 'atk',        label: '攻击',     min: 0,   max: 120,  step: 1 },
    { key: 'def',        label: '防御',     min: 0,   max: 100,  step: 1 },
    { key: 'range',      label: '射程',     min: 0,   max: 900,  step: 10 },
    { key: 'attackSpeed', label: '攻速',    min: 0.2, max: 3,    step: 0.1 },
    { key: 'critRate',   label: '暴击率',   min: 0,   max: 1,    step: 0.05 },
    { key: 'critDmg',    label: '暴击伤害', min: 0,   max: 3,    step: 0.1 },
    { key: 'dodgeRate',  label: '闪避率',   min: 0,   max: 1,    step: 0.05 },
    { key: 'blockRate',  label: '格挡率',   min: 0,   max: 1,    step: 0.05 },
    { key: 'blockRatio', label: '格挡减伤', min: 0,   max: 1,    step: 0.05 },
    { key: 'dmgBonus',   label: '伤害加成', min: 0,   max: 2,    step: 0.05 },
    { key: 'dmgReduce',  label: '伤害减免', min: 0,   max: 0.9,  step: 0.05 },
];

// 职业 → 分组标题
const SOLDIER_TITLE: Record<SoldierClass, string> = { tank: '🛡 坦克', dps: '🔫 输出', healer: '💚 治疗' };

function buildFields(): Field[] {
    const C = BattleConfig;
    const f = (group: string, label: string, min: number, max: number, step: number,
               get: () => number, set: (v: number) => void): Field =>
        ({ group, label, min, max, step, get, set });

    const fields: Field[] = [];

    // —— 小队：每个职业的统一属性 + 行为字段 ——
    (['tank', 'dps', 'healer'] as SoldierClass[]).forEach(cls => {
        const title = SOLDIER_TITLE[cls];
        const st = C.stats[cls];
        for (const m of STAT_META) {
            fields.push(f(title, m.label, m.min, m.max, m.step, () => st[m.key], v => { st[m.key] = v; }));
        }
        const b = C.classes[cls];
        if (cls === 'healer') {
            fields.push(f(title, '每秒治疗', 0, 80, 2, () => b.healPerSec, v => b.healPerSec = v));
        } else {
            fields.push(f(title, '攻击间隔', 0.05, 2, 0.02, () => b.fireInterval, v => b.fireInterval = v));
            if (cls === 'tank') {
                fields.push(f(title, '移速', 0, 600, 20, () => b.moveSpeed, v => b.moveSpeed = v));
                fields.push(f(title, '前压上限', 0, 400, 10, () => b.advanceLimit, v => b.advanceLimit = v));
            }
        }
    });

    // —— 怪物类型表：每种怪的属性 + 移动/体型 ——
    Object.keys(C.enemyTypes).forEach(key => {
        const t = C.enemyTypes[key];
        const title = `👾 ${t.name}`;
        for (const m of STAT_META) {
            fields.push(f(title, m.label, m.min, m.max, m.step, () => t.stats[m.key], v => { t.stats[m.key] = v; }));
        }
        fields.push(f(title, '移速', 20, 320, 10, () => t.speed, v => t.speed = v));
        fields.push(f(title, '体型', 10, 60, 2, () => t.radius, v => t.radius = v));
        fields.push(f(title, '攻击间隔', 0.2, 3, 0.1, () => t.attackInterval, v => t.attackInterval = v));
    });

    // —— 全局 ——
    fields.push(f('⚙ 全局', '关卡(改后重开)', 0, Math.max(0, C.levels.length - 1), 1, () => C.startLevel, v => C.startLevel = v));
    fields.push(f('⚙ 全局', '贴脸距离', 60, 320, 10, () => C.formation.contactGap, v => C.formation.contactGap = v));
    fields.push(f('⚙ 全局', '伤害保底比例', 0, 1, 0.05, () => C.combat.minDamageRate, v => C.combat.minDamageRate = v));

    // —— 关卡：每关波次间隔 + 每波每个刷怪组的数量/间隔 ——
    C.levels.forEach((lv) => {
        const lt = `🗺 ${lv.name}`;
        fields.push(f(lt, '波次间隔', 0, 6, 0.5, () => lv.waveGap, v => lv.waveGap = v));
        lv.waves.forEach((w, wi) => {
            const g = `${lt}·波${wi + 1}`;
            w.spawns.forEach((sp) => {
                const nm = C.enemyTypes[sp.type]?.name || sp.type;
                fields.push(f(g, `${nm}·数量`, 0, 40, 1, () => sp.count, v => sp.count = v));
                fields.push(f(g, `${nm}·间隔`, 0.1, 2, 0.05, () => sp.interval, v => sp.interval = v));
            });
        });
    });

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
        stats: BattleConfig.stats,
        enemyTypes: BattleConfig.enemyTypes,
        levels: BattleConfig.levels,
        startLevel: BattleConfig.startLevel,
        combat: BattleConfig.combat,
        classes: BattleConfig.classes,
        roster: BattleConfig.roster,
        layout: BattleConfig.layout,
        bullet: BattleConfig.bullet,
        formation: BattleConfig.formation,
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
