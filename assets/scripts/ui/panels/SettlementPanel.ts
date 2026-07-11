import { Color, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { BattleConfig } from '../../config/BattleConfig';
import type { CompleteLevelResult } from '../../progression/ProgressModel';
import { QUALITY_COLOR, QUALITY_LABEL, SLOT_LABEL, formatEquipStats } from '../../inventory/EquipDefs';
import type { RewardEntry } from '../UiTypes';

interface SettlementHot {
    x: number;
    y: number;
    w: number;
    h: number;
    kind: 'next' | 'bag' | 'retry';
}

export interface SettlementPanelOptions {
    host: Node;
    halfW: number;
    halfH: number;
    beforeShow: () => void;
    levelName: () => string;
    onOpenBag: () => void;
    onNext: (complete: CompleteLevelResult) => void;
    onRetry: (complete: CompleteLevelResult) => void;
}

const PRESS_SCALE = 0.94;

export class SettlementPanel {
    private readonly root: Node;
    private readonly gfx: Graphics;
    private readonly labels: Label[] = [];
    private readonly hots: SettlementHot[] = [];
    private complete: CompleteLevelResult | null = null;
    private rewards: RewardEntry[] = [];
    private failed = 0;
    private pressedKind: SettlementHot['kind'] | null = null;

    constructor(private readonly options: SettlementPanelOptions) {
        this.root = new Node('SettlementView');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);

        const gfxNode = new Node('SettlementGfx');
        gfxNode.layer = this.root.layer;
        gfxNode.addComponent(UITransform);
        this.gfx = gfxNode.addComponent(Graphics);
        this.root.addChild(gfxNode);
        options.host.addChild(this.root);
        this.root.active = false;

        this.root.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.root.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.root.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.root.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    isOpen(): boolean {
        return this.root.active;
    }

    hide(): void {
        this.root.active = false;
        this.pressedKind = null;
    }

    show(rewards: RewardEntry[], failed: number, complete: CompleteLevelResult): void {
        this.options.beforeShow();
        this.complete = complete;
        this.rewards = rewards;
        this.failed = failed;
        this.pressedKind = null;
        this.root.active = true;
        this.root.setSiblingIndex(this.options.host.children.length - 1);
        this.render();
    }

    destroy(): void {
        this.root.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.root.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.root.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.root.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    private labelAt(i: number): Label {
        while (i >= this.labels.length) {
            const node = new Node('SettleLbl');
            node.layer = this.root.layer;
            node.addComponent(UITransform);
            const label = node.addComponent(Label);
            this.root.addChild(node);
            this.labels.push(label);
        }
        return this.labels[i];
    }

    private render(): void {
        const complete = this.complete;
        if (!complete) return;

        const g = this.gfx;
        g.clear();
        this.hots.length = 0;
        let li = 0;
        const lbl = (x: number, y: number, text: string, size = 20, color = new Color(235, 238, 245)) => {
            const label = this.labelAt(li++);
            label.node.active = true;
            label.node.setPosition(x, y, 0);
            label.string = text;
            label.fontSize = size;
            label.lineHeight = size + 4;
            label.color = color;
        };

        const { halfW, halfH } = this.options;
        g.fillColor = new Color(8, 10, 14, 190);
        g.rect(-halfW, -halfH, halfW * 2, halfH * 2);
        g.fill();

        const w = Math.min(680, halfW * 2 - 80);
        const h = Math.min(500, halfH * 2 - 70);
        const x = -w / 2;
        const y = -h / 2;
        g.fillColor = new Color(26, 30, 40, 245);
        g.roundRect(x, y, w, h, 8);
        g.fill();
        g.strokeColor = new Color(120, 132, 160, 230);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8);
        g.stroke();

        lbl(0, y + h - 40, '通关结算', 32, new Color(255, 226, 126));
        lbl(0, y + h - 76, `${this.options.levelName()}   第 ${complete.completedLevel + 1}/${BattleConfig.levels.length} 关`, 20, new Color(205, 214, 232));

        const rewardY = y + h - 124;
        lbl(x + 70, rewardY, '获得装备', 21, new Color(255, 235, 170));
        if (this.rewards.length === 0) {
            lbl(0, rewardY - 44, this.failed > 0 ? '背包/仓库已满，奖励未领取' : '本次没有掉落', 19, new Color(255, 140, 120));
        } else {
            for (let i = 0; i < Math.min(this.rewards.length, 4); i++) {
                const reward = this.rewards[i];
                const item = reward.item;
                const lineY = rewardY - 40 - i * 44;
                const qualityColor = QUALITY_COLOR[item.quality];
                lbl(x + 110, lineY, `${QUALITY_LABEL[item.quality]} · ${item.name}`, 19, new Color(qualityColor[0], qualityColor[1], qualityColor[2]));
                lbl(x + 320, lineY, `${SLOT_LABEL[item.slot]}  ${formatEquipStats(item.stats, 3) || '无属性'}  进${reward.target}`, 16, new Color(214, 220, 235));
            }
            if (this.failed > 0) lbl(0, rewardY - 222, `${this.failed} 件未领取：背包/仓库已满`, 16, new Color(255, 140, 120));
        }

        const progressText = complete.hasNext
            ? (complete.unlockedNext ? `已解锁：${BattleConfig.levels[complete.nextLevel].name}` : `下一关：${BattleConfig.levels[complete.nextLevel].name}`)
            : '当前内容已全部通关';
        lbl(0, y + 116, progressText, 19, new Color(190, 225, 185));

        const by = y + 34;
        this.drawButton(g, lbl, x + 60, by, 150, 48, complete.hasNext ? '下一关' : '已通关', 'next', complete.hasNext);
        this.drawButton(g, lbl, x + w / 2 - 75, by, 150, 48, '打开背包', 'bag', true);
        this.drawButton(g, lbl, x + w - 210, by, 150, 48, '重打本关', 'retry', true);

        for (let i = li; i < this.labels.length; i++) this.labels[i].node.active = false;
    }

    private drawButton(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        y: number,
        w: number,
        h: number,
        text: string,
        kind: SettlementHot['kind'],
        enabled: boolean,
    ): void {
        const pressed = enabled && this.pressedKind === kind;
        const dw = pressed ? w * (1 - PRESS_SCALE) : 0;
        const dh = pressed ? h * (1 - PRESS_SCALE) : 0;
        const rect = { x: x + dw / 2, y: y + dh / 2, w: w - dw, h: h - dh };
        g.fillColor = enabled ? new Color(67, 76, 96, 245) : new Color(48, 52, 62, 200);
        g.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
        g.fill();
        g.strokeColor = enabled ? new Color(255, 226, 126, 220) : new Color(90, 94, 104, 180);
        g.lineWidth = 2;
        g.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
        g.stroke();
        lbl(x + w / 2, y + h / 2, text, 18, enabled ? new Color(245, 248, 255) : new Color(145, 150, 160));
        if (enabled) this.hots.push({ x, y, w, h, kind });
    }

    private hit(e: EventTouch): SettlementHot | null {
        if (!this.isOpen()) return null;
        const ui = e.getUILocation();
        const p = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        return this.hots.find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) ?? null;
    }

    private onTouchStart(e: EventTouch): void {
        if (!this.isOpen()) return;
        e.propagationStopped = true;
        this.pressedKind = this.hit(e)?.kind ?? null;
        if (this.pressedKind) this.render();
    }

    private onTouchMove(e: EventTouch): void {
        if (!this.pressedKind) return;
        if (this.hit(e)?.kind === this.pressedKind) return;
        this.pressedKind = null;
        this.render();
    }

    private onTouchCancel(): void {
        if (!this.pressedKind) return;
        this.pressedKind = null;
        this.render();
    }

    private onTouchEnd(e: EventTouch): void {
        if (!this.isOpen()) return;
        e.propagationStopped = true;
        const hit = this.hit(e);
        if (this.pressedKind) {
            this.pressedKind = null;
            this.render();
        }
        if (!hit || !this.complete) return;

        if (hit.kind === 'bag') this.options.onOpenBag();
        else if (hit.kind === 'next') this.options.onNext(this.complete);
        else this.options.onRetry(this.complete);
    }
}
