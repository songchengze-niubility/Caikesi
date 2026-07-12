// 角色天赋覆盖层：职业页签 + 等级门槛分层网格 + 免费洗点（两击确认）。
// 无节点连线（唯一前置=角色等级）；点可投节点直接投 1 点；持久化由回调注入（组合根 BattleEntry）。

import { Color, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { charTalentNodes, charTalentPassiveAt, type CharTalentNodeDef } from '../../chartalent/CharTalentConfig';
import { availablePoints, learnNode, nodeLevelOf, resetChar, type CharTalentSave } from '../../chartalent/CharTalentModel';
import { CHARACTER_LABEL, CHARACTERS, CharacterId } from '../../inventory/EquipDefs';
import type { CharacterGrowthModel } from '../../growth/CharacterGrowthModel';

interface PanelHot {
    rect: { x: number; y: number; w: number; h: number };
    act: () => void;
}

export interface CharTalentPanelOptions {
    host: Node;
    halfW: number;
    halfH: number;
    getSave: () => CharTalentSave;                     // 组合根缓存，learnNode/resetChar 就地写
    getGrowth: () => CharacterGrowthModel | null;
    beforeShow: () => void;
    persist: () => void;                               // 投点/洗点成功后落盘
}

const STAT_LABEL: Record<string, string> = {
    hp: '生命', atk: '攻击', def: '防御', hpPct: '生命', atkPct: '攻击', defPct: '防御',
    attackSpeed: '攻速', critRate: '暴击率', critDmg: '暴击伤害', dodgeRate: '闪避',
    blockRate: '格挡率', blockRatio: '格挡强度', dmgReduce: '免伤', moveSpeedPct: '移速',
    skillHaste: '技能急速', basicDmgBonus: '普攻伤害', skillDmgBonus: '技能伤害',
    singleDmgBonus: '单体伤害', aoeDmgBonus: '群体伤害',
};
// 展示成百分比的属性键（其余按整数平铺值展示）
const PCT_KEYS = new Set(['hpPct', 'atkPct', 'defPct', 'moveSpeedPct', 'critRate', 'dodgeRate',
    'blockRate', 'blockRatio', 'dmgReduce', 'skillHaste', 'basicDmgBonus', 'skillDmgBonus',
    'singleDmgBonus', 'aoeDmgBonus', 'attackSpeed', 'critDmg']);

// 节点效果摘要：stat → 当前累计值（未投时展示 1 级效果）；passive → 名称+已学标记
function fmtEffect(node: CharTalentNodeDef, lv: number): string {
    if (node.kind === 'passive') {
        const def = charTalentPassiveAt(node.id, Math.max(1, lv));
        return lv > 0 ? `被动·${def?.name ?? node.label}` : '被动（未学）';
    }
    const name = STAT_LABEL[node.statKey] ?? node.statKey;
    const v = node.valuePerLevel * Math.max(1, lv);
    if (PCT_KEYS.has(node.statKey)) return `${name} +${Math.round(v * 1000) / 10}%`;
    return `${name} +${v}`;
}

export class CharTalentPanel {
    private readonly root: Node;
    private readonly gfx: Graphics;
    private readonly labels: Label[] = [];
    private readonly hots: PanelHot[] = [];
    private activeCls: CharacterId = 'tank';
    private resetArmed = false;
    private message = '';

    constructor(private readonly options: CharTalentPanelOptions) {
        this.root = new Node('CharTalentView');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);

        const gfxNode = new Node('CharTalentGfx');
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

    show(cls?: CharacterId): void {
        this.options.beforeShow();
        if (cls) this.activeCls = cls;
        this.message = '';
        this.resetArmed = false;
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
            const node = new Node('CharTalentLbl');
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

        const save = this.options.getSave();
        const cls = this.activeCls;
        const charLevel = this.options.getGrowth()?.levelOf(cls) ?? 1;
        const points = availablePoints(save, cls, charLevel);
        label(`角色天赋  ${CHARACTER_LABEL[cls]} Lv.${charLevel}  剩余 ${points} 点`, 0, 640, 28, new Color(255, 226, 126, 255));
        label('每升 1 级得 1 点；达到等级门槛即可投点，随时免费洗点', 0, 600, 16, new Color(170, 178, 194, 255));

        // 职业页签
        const tabW = 200, tabH = 60;
        CHARACTERS.forEach((c, i) => {
            const x = -tabW * 1.5 - 20 + i * (tabW + 20);
            const active = c === cls;
            g.fillColor = active ? new Color(64, 90, 130, 255) : new Color(44, 48, 56, 255);
            g.roundRect(x, 530, tabW, tabH, 10);
            g.fill();
            label(CHARACTER_LABEL[c], x + tabW / 2, 560, 22, active ? undefined : new Color(150, 156, 168, 255));
            if (!active) this.hots.push({ rect: { x, y: 530, w: tabW, h: tabH }, act: () => { this.activeCls = c; this.message = ''; this.resetArmed = false; this.render(); } });
        });

        // 节点网格：行 = tier（等级门槛层），每层 1~2 节点左右排
        const nodeW = 380, nodeH = 96;
        const tiers = new Map<number, CharTalentNodeDef[]>();
        for (const node of charTalentNodes(cls)) {
            const list = tiers.get(node.tier) ?? [];
            list.push(node);
            tiers.set(node.tier, list);
        }
        let y = 440;
        for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
            const list = tiers.get(tier)!;
            label(`Lv.${list[0].levelReq}`, -440, y, 18, new Color(170, 178, 194, 255));
            list.forEach((node, i) => {
                const x = list.length === 1 ? -nodeW / 2 : -nodeW - 10 + i * (nodeW + 20);
                const lv = nodeLevelOf(save, cls, node.id);
                const maxed = lv >= node.maxLevel;
                const gated = charLevel < node.levelReq;
                g.fillColor = maxed ? new Color(146, 116, 44, 255)
                    : gated ? new Color(44, 48, 56, 255)
                    : new Color(52, 74, 104, 255);
                g.roundRect(x, y - nodeH / 2, nodeW, nodeH, 10);
                g.fill();
                const textColor = gated ? new Color(120, 126, 138, 255) : undefined;
                label(`${node.label}  ${lv}/${node.maxLevel}`, x + nodeW / 2, y + 18, 20, textColor);
                const sub = gated ? `Lv.${node.levelReq} 解锁` : fmtEffect(node, lv);
                label(sub, x + nodeW / 2, y - 16, 15, maxed ? new Color(255, 226, 126, 255) : textColor);
                if (!maxed && !gated) {
                    this.hots.push({ rect: { x, y: y - nodeH / 2, w: nodeW, h: nodeH }, act: () => this.learn(node.id) });
                }
            });
            y -= 130;
        }

        // 洗点（两击确认）
        g.fillColor = this.resetArmed ? new Color(150, 80, 50, 255) : new Color(70, 74, 84, 255);
        g.roundRect(-210, -600, 420, 56, 10);
        g.fill();
        label(this.resetArmed ? '再点一次确认洗点（免费，清空本角色全部投点）' : '洗点（免费）', 0, -572, 20);
        this.hots.push({ rect: { x: -210, y: -600, w: 420, h: 56 }, act: () => this.reset() });

        if (this.message) label(this.message, 0, -650, 18, new Color(255, 160, 140, 255));

        g.fillColor = new Color(120, 60, 60, 255);
        g.roundRect(-90, -730, 180, 60, 12);
        g.fill();
        label('关闭', 0, -700, 24);
        this.hots.push({ rect: { x: -90, y: -730, w: 180, h: 60 }, act: () => this.hide() });
    }

    private learn(nodeId: string): void {
        const charLevel = this.options.getGrowth()?.levelOf(this.activeCls) ?? 1;
        const r = learnNode(this.options.getSave(), this.activeCls, nodeId, charLevel);
        if (r.ok) {
            this.message = '';
            this.options.persist();
        } else {
            this.message = r.reason ?? '无法学习';
        }
        this.resetArmed = false;
        this.render();
    }

    private reset(): void {
        if (!this.resetArmed) {
            this.resetArmed = true;
            this.render();
            return;
        }
        resetChar(this.options.getSave(), this.activeCls);
        this.resetArmed = false;
        this.message = '';
        this.options.persist();
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
