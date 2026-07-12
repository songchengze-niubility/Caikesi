// 心法（全局天赋树）覆盖层：分支分列、tier 分行、前置未满灰显；点节点走 TalentModel。
// 持久化由回调注入（组合根 BattleEntry）。占位色块阶段：不画连线，靠列/行 + 灰显表达树结构。

import { Color, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { talentNodes, talentLevelCost, type TalentBranch, type TalentNodeDef } from '../../talent/TalentConfig';
import { learnNode, nodeLevel, prereqMet, type TalentSave } from '../../talent/TalentModel';
import { talentAggregate } from '../../talent/TalentStats';
import type { MaterialSave } from '../../services/RewardTypes';

interface TalentHot {
    rect: { x: number; y: number; w: number; h: number };
    act: () => void;
}

export interface TalentPanelOptions {
    host: Node;
    halfW: number;
    halfH: number;
    getTalents: () => TalentSave;        // 组合根缓存，learnNode 就地写
    getMaterials: () => MaterialSave;    // 同上
    getGold: () => number;
    getAutoSellOn: () => boolean;
    setAutoSellOn: (on: boolean) => void;
    beforeShow: () => void;
    // 点节点成功后持久化：spentGold 为本次扣减额（delta，防并发面板改金币互相覆盖）
    persist: (spentGold: number) => void;
}

const BRANCH_X: Record<TalentBranch, number> = { trunk: -352, combat: -117, economy: 117, drop: 352 };
const BRANCH_LABEL: Record<TalentBranch, string> = { trunk: '主干', combat: '战斗', economy: '经济', drop: '掉落' };

const EFFECT_LABEL: Record<string, string> = {
    hpPct: '生命', atkPct: '攻击', defPct: '防御', critRate: '暴击率', dmgBonus: '全伤害',
    skillHaste: '技能急速', basicDmgBonus: '普攻伤害',
    gold: '金币获取', exp: '经验获取', offlineRate: '离线收益',
    equipQuality: '稀有装备率',
    squadSlot3: '第3上阵位', chestCapacity: '宝箱容量', autoSell: '自动卖白绿', offlineCap: '离线时长',
};

function fmtEffect(node: TalentNodeDef, lv: number): string {
    const name = EFFECT_LABEL[node.effectKey] ?? node.effectKey;
    if (node.effectKind === 'unlock' && (node.effectKey === 'squadSlot3' || node.effectKey === 'autoSell')) {
        return lv > 0 ? `${name}（已解锁）` : name;
    }
    const v = node.valuePerLevel * Math.max(1, lv);   // 未点时展示 1 级效果
    if (node.effectKey === 'chestCapacity') return `${name} +${v}`;
    if (node.effectKey === 'offlineCap') return `${name} +${Math.round(v / 3600)}小时`;
    if (v > 0 && v < 1) return `${name} +${Math.round(v * 1000) / 10}%`;
    return `${name} +${v}`;
}

export class TalentPanel {
    private readonly root: Node;
    private readonly gfx: Graphics;
    private readonly labels: Label[] = [];
    private readonly hots: TalentHot[] = [];
    private message = '';

    constructor(private readonly options: TalentPanelOptions) {
        this.root = new Node('TalentView');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);

        const gfxNode = new Node('TalentGfx');
        gfxNode.layer = this.root.layer;
        gfxNode.addComponent(UITransform);
        this.gfx = gfxNode.addComponent(Graphics);
        this.root.addChild(gfxNode);
        options.host.addChild(this.root);
        this.root.active = false;
        this.root.on(Node.EventType.TOUCH_END, this.onTap, this);
    }

    isOpen(): boolean { return this.root.active; }

    toggle(): void {
        if (this.isOpen()) this.hide();
        else this.show();
    }

    show(): void {
        this.options.beforeShow();
        this.message = '';
        this.root.active = true;
        this.root.setSiblingIndex(this.options.host.children.length - 1);
        this.render();
    }

    hide(): void { this.root.active = false; }

    destroy(): void {
        this.root.off(Node.EventType.TOUCH_END, this.onTap, this);
    }

    private labelAt(i: number): Label {
        while (i >= this.labels.length) {
            const node = new Node('TalentLbl');
            node.layer = this.root.layer;
            node.addComponent(UITransform);
            const label = node.addComponent(Label);
            this.root.addChild(node);
            this.labels.push(label);
        }
        return this.labels[i];
    }

    private render(): void {
        const g = this.gfx;
        g.clear();
        this.hots.length = 0;
        for (const label of this.labels) label.node.active = false;
        let li = 0;
        const label = (text: string, x: number, y: number, size = 20, color?: Color) => {
            const item = this.labelAt(li++);
            item.node.active = true;
            item.string = text;
            item.fontSize = size;
            item.color = color ?? new Color(235, 235, 240, 255);
            item.node.setPosition(x, y, 0);
        };

        g.fillColor = new Color(18, 22, 28, 235);
        g.rect(-this.options.halfW, -this.options.halfH, this.options.halfW * 2, this.options.halfH * 2);
        g.fill();

        const save = this.options.getTalents();
        const mats = this.options.getMaterials();
        const gold = this.options.getGold();
        label(`心法  金币 ${gold}  秘笈残页 ${mats['talent_page'] ?? 0}`, 0, 640, 28, new Color(255, 226, 126, 255));
        label('前置点满解锁后继；小节点花金币，大节点另需残页（关卡首通获得）', 0, 600, 16, new Color(170, 178, 194, 255));

        // 分支列头
        for (const b of Object.keys(BRANCH_X) as TalentBranch[]) {
            label(BRANCH_LABEL[b], BRANCH_X[b], 555, 22, new Color(200, 210, 230, 255));
        }

        // 节点网格：列=branch，行=tier
        const w = 208, h = 84;
        for (const node of talentNodes()) {
            const x = BRANCH_X[node.branch] - w / 2;
            const y = 520 - node.tier * 100;
            const lv = nodeLevel(save, node.id);
            const maxed = lv >= node.maxLevel;
            const unlocked = prereqMet(node, save);
            g.fillColor = maxed ? new Color(146, 116, 44, 255)
                : unlocked ? new Color(52, 74, 104, 255)
                : new Color(44, 48, 56, 255);
            g.roundRect(x, y - h / 2, w, h, 10);
            g.fill();
            const textColor = unlocked || maxed ? undefined : new Color(120, 126, 138, 255);
            label(`${node.label}  ${lv}/${node.maxLevel}`, x + w / 2, y + 16, 20, textColor);
            if (maxed) {
                label(fmtEffect(node, lv), x + w / 2, y - 14, 15, new Color(255, 226, 126, 255));
            } else {
                const cost = talentLevelCost(node, lv + 1);
                const costText = cost.pages > 0 ? `${cost.gold}金 ${cost.pages}页` : `${cost.gold}金`;
                label(`${fmtEffect(node, lv)} · ${costText}`, x + w / 2, y - 14, 14, textColor);
                this.hots.push({ rect: { x, y: y - h / 2, w, h }, act: () => this.learn(node.id) });
            }
        }

        // 自动卖开关（「拂尘」解锁后出现）
        const agg = talentAggregate(save);
        if (agg.unlocks.autoSell) {
            const on = this.options.getAutoSellOn();
            g.fillColor = on ? new Color(64, 110, 74, 255) : new Color(70, 74, 84, 255);
            g.roundRect(-210, -608, 420, 56, 10);
            g.fill();
            label(`自动出售白/绿装：${on ? '开' : '关'}（点击切换）`, 0, -580, 20);
            this.hots.push({ rect: { x: -210, y: -608, w: 420, h: 56 }, act: () => { this.options.setAutoSellOn(!on); this.render(); } });
        }

        if (this.message) label(this.message, 0, -650, 18, new Color(255, 160, 140, 255));

        g.fillColor = new Color(120, 60, 60, 255);
        g.roundRect(-90, -730, 180, 60, 12);
        g.fill();
        label('关闭', 0, -700, 24);
        this.hots.push({ rect: { x: -90, y: -730, w: 180, h: 60 }, act: () => this.hide() });
    }

    private learn(nodeId: string): void {
        const wallet = { gold: this.options.getGold() };
        const r = learnNode(this.options.getTalents(), nodeId, wallet, this.options.getMaterials());
        if (r.ok) {
            this.message = '';
            this.options.persist(r.spentGold ?? 0);
        } else {
            this.message = r.reason ?? '无法修炼';
        }
        this.render();
    }

    private onTap(e: EventTouch): void {
        const ui = e.getUILocation();
        const p = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        for (const hot of this.hots) {
            const rect = hot.rect;
            if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) {
                hot.act();
                return;
            }
        }
    }
}
