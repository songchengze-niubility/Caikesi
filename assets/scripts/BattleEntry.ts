// 战斗入口（BattleEntry）—— 挂到场景节点上的唯一脚本
// 作用：建战场、驱动 BattleManager、用 Graphics 把所有单位画成色块（占位）、显示文字、处理重开。
// 第一版没有美术：士兵=蓝色方块，敌人=红色圆，子弹=黄色点。验证战斗循环用。

import { _decorator, Component, Node, Graphics, Color, UITransform, Label, view } from 'cc';
import { BattleManager } from './combat/BattleManager';
import { Background } from './combat/Background';
import { BattleConfig, SoldierClass } from './config/BattleConfig';
import { mountConfigPanel } from './debug/ConfigPanel';
import { InventoryModel } from './inventory/InventoryModel';
import { InventoryView } from './inventory/InventoryView';
import { loadInventory, saveInventory } from './inventory/InventoryPersistence';

const { ccclass } = _decorator;

@ccclass('BattleEntry')
export class BattleEntry extends Component {
    private _gfx: Graphics = null!;
    private _waveLabel: Label = null!;
    private _hpLabel: Label = null!;
    private _statusLabel: Label = null!;

    private _mgr: BattleManager = null!;
    private _bg: Background = null!;
    private _inv: InventoryModel = null!;
    private _invView: InventoryView = null!;
    private _halfW = 0;
    private _halfH = 0;

    // 颜色（占位）—— 按职业区分
    private _cClass: Record<SoldierClass, Color> = {
        tank: new Color(70, 170, 200),    // 坦克：青蓝
        dps: new Color(255, 150, 60),     // 输出：橙
        healer: new Color(90, 220, 120),  // 治疗：绿
    };
    private _cSoldierHurt = new Color(110, 110, 120); // 残血变灰
    private _cEnemy = new Color(230, 70, 70, 170);  // 半透明：怪叠越厚红越深
    private _cEnemyHpBg = new Color(60, 30, 30);
    private _cEnemyHp = new Color(90, 220, 120);
    private _cBullet = new Color(255, 220, 60);
    private _cHealBeam = new Color(120, 255, 160, 160);
    private _cMeleeBeam = new Color(255, 255, 255, 210);

    onLoad() {
        const vs = view.getVisibleSize();
        this._halfW = vs.width / 2;
        this._halfH = vs.height / 2;

        // 让本节点铺满全屏，方便接收点击（重开用）
        const ut = this.getComponent(UITransform) || this.addComponent(UITransform);
        ut.setContentSize(vs.width, vs.height);

        // 背景节点：最先加入 → 渲染在最底层（蓝天白云 + 地面）。
        // 【替换真实背景】：给这个 bgNode 加 Sprite 指定图片即可，无需改战斗代码。
        const bgNode = new Node('Bg');
        bgNode.layer = this.node.layer;
        bgNode.addComponent(UITransform);
        const bgGfx = bgNode.addComponent(Graphics);
        this.node.addChild(bgNode);
        bgNode.setPosition(0, 0, 0);
        this._bg = new Background(bgGfx, this._halfW, this._halfH);

        // 画布：一个居中的子节点，本地坐标 (0,0) 即屏幕中心
        const gfxNode = new Node('Gfx');
        gfxNode.layer = this.node.layer;
        gfxNode.addComponent(UITransform);
        this._gfx = gfxNode.addComponent(Graphics);
        this.node.addChild(gfxNode);
        gfxNode.setPosition(0, 0, 0);

        // 文字
        this._waveLabel = this._makeLabel('', 0, this._halfH - 80, 40);
        this._hpLabel = this._makeLabel('', 0, this._halfH - 130, 30);
        this._statusLabel = this._makeLabel('', 0, 0, 56);
        this._statusLabel.color = new Color(255, 230, 120);

        // 点击重开
        this.node.on(Node.EventType.TOUCH_END, this._onTap, this);

        this._startBattle();

        // —— 装备背包（独立子系统，不影响战斗）——
        this._inv = new InventoryModel();
        this._invView = new InventoryView(this.node, this._halfW, this._halfH, this._inv, () => {
            void saveInventory(this._inv);   // 任何成功操作后存盘
        });
        void loadInventory(this._inv).then(() => { this._invView.refresh(); });

        // 「背包」「掉落」两个按钮（占位 Label，点了切换面板 / 调试掉落）
        this._makeButton('背包', -this._halfW + 70, -this._halfH + 40, () => this._invView.toggle());
        this._makeButton('掉落', -this._halfW + 180, -this._halfH + 40, () => {
            const r = this._inv.dropRandom();
            if (r.ok) void saveInventory(this._inv);
            this._invView.refresh();   // 面板打开时即时刷新（关着则无副作用）
        });

        // 挂载游戏内实时调参面板（仅网页预览生效；点「重开战斗」重置局内数值）
        mountConfigPanel(() => this._startBattle());
    }

    private _startBattle() {
        this._mgr = new BattleManager(this._halfW, this._halfH);
        this._statusLabel.string = '';
    }

    private _onTap() {
        if (this._invView && this._invView.isOpen()) return;  // 面板打开时，点击交给面板，不重开战斗
        // 仅在分出胜负后，点击重开
        if (this._mgr.phase === 'won' || this._mgr.phase === 'lost') {
            this._startBattle();
        }
    }

    update(dt: number) {
        if (!this._mgr) return;
        this._bg.update(dt);   // 背景（云飘动）
        // dt 兜底，防止切后台回来一帧巨大导致瞬移
        this._mgr.tick(Math.min(dt, 0.05));
        this._render();
        this._renderFloats();
        this._updateLabels();
        this._invView.update(dt);
    }

    // —— 战斗飘字（用 Label 池，按需复用）——
    private _floats: Label[] = [];
    private _getFloat(i: number): Label {
        while (i >= this._floats.length) {
            const node = new Node('Float');
            node.layer = this.node.layer;
            node.addComponent(UITransform);
            const lb = node.addComponent(Label);
            this.node.addChild(node);
            this._floats.push(lb);
        }
        return this._floats[i];
    }

    private _renderFloats() {
        const list = this._mgr.floatTexts;
        for (let i = 0; i < list.length; i++) {
            const ft = list[i];
            const lb = this._getFloat(i);
            lb.node.active = true;
            lb.node.setPosition(ft.x, ft.y, 0);
            lb.string = ft.text;
            const a = Math.max(0, Math.min(1, ft.ttl / ft.maxTtl)) * 255;
            switch (ft.kind) {
                case 'crit':  lb.fontSize = 42; lb.color = new Color(255, 180, 40, a); break;
                case 'block': lb.fontSize = 28; lb.color = new Color(120, 200, 255, a); break;
                case 'dodge': lb.fontSize = 28; lb.color = new Color(210, 210, 210, a); break;
                default:      lb.fontSize = 30; lb.color = new Color(255, 255, 255, a); break;
            }
            lb.lineHeight = lb.fontSize + 4;
        }
        // 多余的 Label 隐藏
        for (let i = list.length; i < this._floats.length; i++) {
            this._floats[i].node.active = false;
        }
    }

    // —— 把所有单位画成色块 ——
    private _render() {
        const g = this._gfx;
        g.clear();

        // 子弹
        const br = BattleConfig.bullet.radius;
        g.fillColor = this._cBullet;
        for (const b of this._mgr.bullets) {
            g.circle(b.x, b.y, br);
        }
        g.fill();

        // 敌人（按类型上色的圆 + 头顶血条；体型/颜色随怪类型）
        for (const e of this._mgr.enemies) {
            const er = e.radius;
            g.fillColor = new Color(e.color[0], e.color[1], e.color[2], 200);
            g.circle(e.x, e.y, er);
            g.fill();

            // 血条
            const w = er * 2;
            const ratio = Math.max(0, e.hp / e.maxHp);
            const by = e.y + er + 8;
            g.fillColor = this._cEnemyHpBg;
            g.rect(e.x - er, by, w, 6);
            g.fill();
            g.fillColor = this._cEnemyHp;
            g.rect(e.x - er, by, w * ratio, 6);
            g.fill();
        }

        // 近战劈砍连线（白色粗线，近战单位→正在劈的怪）
        g.strokeColor = this._cMeleeBeam;
        g.lineWidth = 7;
        for (const mb of this._mgr.meleeBeams) {
            g.moveTo(mb.fromX, mb.fromY);
            g.lineTo(mb.toX, mb.toY);
        }
        g.stroke();

        // 治疗光束（绿色细线，治疗→被奶的队友）
        g.strokeColor = this._cHealBeam;
        g.lineWidth = 4;
        for (const hb of this._mgr.healBeams) {
            g.moveTo(hb.fromX, hb.fromY);
            g.lineTo(hb.toX, hb.toY);
        }
        g.stroke();

        // 士兵（按职业上色的方块，受伤变灰；坦克更大）
        for (const sol of this._mgr.soldiers) {
            if (!sol.alive) continue;
            const size = BattleConfig.classes[sol.cls].size;
            const ratio = sol.hp / sol.maxHp;
            g.fillColor = ratio > 0.35 ? this._cClass[sol.cls] : this._cSoldierHurt;
            g.rect(sol.x - size / 2, sol.y - size / 2, size, size);
            g.fill();

            // 士兵头顶血条
            const w = size;
            const by = sol.y + size / 2 + 6;
            g.fillColor = this._cEnemyHpBg;
            g.rect(sol.x - w / 2, by, w, 5);
            g.fill();
            g.fillColor = this._cEnemyHp;
            g.rect(sol.x - w / 2, by, w * ratio, 5);
            g.fill();
        }
    }

    private _updateLabels() {
        const m = this._mgr;
        this._waveLabel.string = `${m.levelName}   第 ${m.waveIndex + 1}/${m.totalWaves} 波`;
        this._hpLabel.string = `小队血量: ${Math.ceil(m.squadHpTotal)}/${m.squadHpMax}`;

        if (m.phase === 'won') {
            this._statusLabel.string = '🎉 通关！点击重开';
        } else if (m.phase === 'lost') {
            this._statusLabel.string = '💀 小队全灭  点击重开';
        } else {
            this._statusLabel.string = '';
        }
    }

    private _makeLabel(text: string, x: number, y: number, size: number): Label {
        const node = new Node('Label');
        node.layer = this.node.layer;
        node.addComponent(UITransform);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 6;
        this.node.addChild(node);
        node.setPosition(x, y, 0);
        return label;
    }

    private _makeButton(text: string, x: number, y: number, onClick: () => void): Label {
        const node = new Node('Btn');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(100, 44);
        const label = node.addComponent(Label);
        label.string = text; label.fontSize = 22; label.lineHeight = 26;
        this.node.addChild(node);
        node.setPosition(x, y, 0);
        node.on(Node.EventType.TOUCH_END, (e: any) => { e.propagationStopped = true; onClick(); }, this);
        return label;
    }

    onDestroy() {
        this.node.off(Node.EventType.TOUCH_END, this._onTap, this);
    }
}
