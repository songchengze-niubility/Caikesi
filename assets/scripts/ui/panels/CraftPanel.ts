import { Color, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { QUALITY_COLOR, QUALITY_LABEL, SLOT_LABEL, SLOTS } from '../../inventory/EquipDefs';
import type { EquipItem, EquipSlot } from '../../inventory/EquipDefs';
import { canAffordCraftTier, craftTierIds, getCraftTier } from '../../config/CraftConfig';
import type { CraftTierConfig } from '../../config/CraftConfig';
import { craftEquipment } from '../../craft/CraftService';
import { MATERIAL_LABEL } from '../../services/RewardTypes';
import type { MaterialId, MaterialSave } from '../../services/RewardTypes';
import type { RewardEntry } from '../UiTypes';

interface CraftHot {
    x: number;
    y: number;
    w: number;
    h: number;
    kind: 'tier' | 'slot' | 'craft' | 'close';
    tierId?: string;
    slot?: EquipSlot;
}

export interface CraftPanelOptions {
    host: Node;
    halfW: number;
    halfH: number;
    getMaterials: () => MaterialSave;
    availableEquipmentSlots: () => number;
    addEquipment: (items: EquipItem[]) => { received: RewardEntry[]; failed: number };
    persist: (remainingMaterials: MaterialSave) => Promise<void>;
    beforeShow: () => void;
}

const PRESS_SCALE = 0.94;

export class CraftPanel {
    private readonly root: Node;
    private readonly gfx: Graphics;
    private readonly labels: Label[] = [];
    private readonly hots: CraftHot[] = [];
    private pressedKind: CraftHot['kind'] | null = null;
    private pressedTierId = '';
    private pressedSlot: EquipSlot | null = null;
    private selectedTier = '';
    private selectedSlot: EquipSlot = 'weapon';
    private message = '';
    private lastResult: RewardEntry | null = null;

    constructor(private readonly options: CraftPanelOptions) {
        this.root = new Node('CraftView');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);

        const gfxNode = new Node('CraftGfx');
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

    toggle(): void {
        if (this.isOpen()) this.hide();
        else this.show();
    }

    show(): void {
        this.options.beforeShow();
        this.ensureSelectedTier();
        this.root.active = true;
        this.root.setSiblingIndex(this.options.host.children.length - 1);
        this.render();
    }

    hide(): void {
        this.root.active = false;
        this.pressedKind = null;
        this.pressedTierId = '';
        this.pressedSlot = null;
    }

    destroy(): void {
        this.root.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.root.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.root.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.root.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    private ensureSelectedTier(): string {
        const ids = craftTierIds();
        if (ids.indexOf(this.selectedTier) >= 0) return this.selectedTier;
        this.selectedTier = ids[0] ?? '';
        return this.selectedTier;
    }

    private labelAt(i: number): Label {
        while (i >= this.labels.length) {
            const node = new Node('CraftLbl');
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
        const tierId = this.ensureSelectedTier();
        const tier = tierId ? getCraftTier(tierId) : null;
        let li = 0;
        const lbl = (x: number, y: number, text: string, size = 20, color = new Color(235, 238, 245)) => {
            const label = this.labelAt(li++);
            label.node.active = true;
            label.node.setPosition(x, y, 0);
            label.string = text;
            label.fontSize = size;
            label.lineHeight = size + 4;
            label.color = color;
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
        };

        g.fillColor = new Color(8, 10, 14, 170);
        g.rect(-this.options.halfW, -this.options.halfH, this.options.halfW * 2, this.options.halfH * 2);
        g.fill();

        const w = Math.min(760, this.options.halfW * 2 - 80);
        const h = Math.min(650, this.options.halfH * 2 - 90);
        const x = -w / 2;
        const y = -h / 2;
        g.fillColor = new Color(28, 31, 40, 246);
        g.roundRect(x, y, w, h, 8);
        g.fill();
        g.strokeColor = new Color(140, 200, 255, 205);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8);
        g.stroke();

        lbl(0, y + h - 42, '材料合成', 30, new Color(140, 200, 255));
        lbl(0, y + h - 82, this.materialsHoldingText(), 18, new Color(190, 220, 190));
        this.drawTierRow(g, lbl, x + 28, y + h - 130, w - 56, 54);
        this.drawSlotRow(g, lbl, x + 28, y + h - 206, w - 56, 54);
        this.drawCost(g, lbl, x + 28, y + h - 260, w - 56, 78, tier);
        this.drawResult(g, lbl, x + 28, y + 96, w - 56, 150);
        if (this.message) lbl(0, y + 78, this.message, 17, new Color(255, 210, 150));

        const canCraft = !!tier && canAffordCraftTier(this.options.getMaterials(), tierId);
        this.drawButton(g, lbl, x + 70, y + 40, 200, 50, '合成', 'craft', canCraft);
        this.drawButton(g, lbl, x + w - 250, y + 40, 180, 50, '关闭', 'close', true);
        for (let i = li; i < this.labels.length; i++) this.labels[i].node.active = false;
    }

    private materialsHoldingText(): string {
        const materials = this.options.getMaterials();
        const ids: MaterialId[] = ['forge_stone', 'rune_scroll'];
        return ids.map(id => `${MATERIAL_LABEL[id]} ${materials[id] ?? 0}`).join('  ·  ');
    }

    private drawTierRow(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        rowH: number,
    ): void {
        const ids = craftTierIds();
        const gap = 10;
        const buttonW = (w - gap * Math.max(0, ids.length - 1)) / Math.max(1, ids.length);
        for (let i = 0; i < ids.length; i++) {
            const tierId = ids[i];
            const tier = getCraftTier(tierId);
            const bx = x + i * (buttonW + gap);
            const pressed = this.pressedKind === 'tier' && this.pressedTierId === tierId;
            const rect = this.pressRect(bx, topY, buttonW, rowH, pressed);
            const selected = tierId === this.selectedTier;
            g.fillColor = selected ? new Color(72, 110, 150, 245) : new Color(43, 48, 60, 235);
            g.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
            g.fill();
            g.strokeColor = selected ? new Color(140, 200, 255, 230) : new Color(88, 96, 112, 190);
            g.lineWidth = selected ? 3 : 2;
            g.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
            g.stroke();
            lbl(bx + buttonW / 2, topY + rowH / 2 + 8, tier.label, 17, new Color(245, 248, 255));
            lbl(bx + buttonW / 2, topY + rowH / 2 - 13, `Lv.${tier.levelMin}-${tier.levelMax}`, 13, new Color(180, 188, 204));
            this.hots.push({ x: bx, y: topY, w: buttonW, h: rowH, kind: 'tier', tierId });
        }
    }

    private drawSlotRow(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        rowH: number,
    ): void {
        const gap = 8;
        const buttonW = (w - gap * (SLOTS.length - 1)) / SLOTS.length;
        for (let i = 0; i < SLOTS.length; i++) {
            const slot = SLOTS[i];
            const bx = x + i * (buttonW + gap);
            const pressed = this.pressedKind === 'slot' && this.pressedSlot === slot;
            const rect = this.pressRect(bx, topY, buttonW, rowH, pressed);
            const selected = slot === this.selectedSlot;
            g.fillColor = selected ? new Color(72, 110, 150, 245) : new Color(43, 48, 60, 235);
            g.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
            g.fill();
            g.strokeColor = selected ? new Color(140, 200, 255, 230) : new Color(88, 96, 112, 190);
            g.lineWidth = selected ? 3 : 2;
            g.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
            g.stroke();
            lbl(bx + buttonW / 2, topY + rowH / 2, SLOT_LABEL[slot], 16, new Color(245, 248, 255));
            this.hots.push({ x: bx, y: topY, w: buttonW, h: rowH, kind: 'slot', slot });
        }
    }

    private drawCost(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        h: number,
        tier: CraftTierConfig | null,
    ): void {
        g.fillColor = new Color(35, 39, 50, 235);
        g.roundRect(x, topY - h, w, h, 8);
        g.fill();
        g.strokeColor = new Color(88, 96, 112, 190);
        g.lineWidth = 2;
        g.roundRect(x, topY - h, w, h, 8);
        g.stroke();
        if (!tier) {
            lbl(x + w / 2, topY - h / 2, '暂无可用合成档位', 17, new Color(170, 178, 194));
            return;
        }
        const materials = this.options.getMaterials();
        const costText = (['forge_stone'] as MaterialId[])
            .filter(id => (tier.cost[id] ?? 0) > 0)
            .map(id => {
                const need = tier.cost[id] ?? 0;
                const have = materials[id] ?? 0;
                return `${MATERIAL_LABEL[id]} ${have}/${need}${have >= need ? '' : '（不足）'}`;
            })
            .join('   ');
        lbl(x + w / 2, topY - 26, `消耗材料：${costText}`, 16, new Color(230, 232, 238));
        lbl(x + w / 2, topY - 54, `产出：Lv.${tier.levelMin}-${tier.levelMax} 随机品质装备`, 15, new Color(180, 220, 190));
    }

    private drawResult(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        y: number,
        w: number,
        h: number,
    ): void {
        g.fillColor = new Color(32, 35, 45, 235);
        g.roundRect(x, y, w, h, 8);
        g.fill();
        g.strokeColor = new Color(88, 96, 112, 190);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8);
        g.stroke();
        lbl(x + w / 2, y + h - 28, '本次合成结果', 20, new Color(230, 232, 238));
        if (!this.lastResult) {
            lbl(x + w / 2, y + h / 2 - 8, '合成后在这里查看结果', 17, new Color(165, 174, 192));
            return;
        }
        const reward = this.lastResult;
        const qualityColor = QUALITY_COLOR[reward.item.quality];
        const cardW = Math.min(260, w - 40);
        const cx = x + (w - cardW) / 2;
        const cy = y + h - 118;
        g.fillColor = new Color(qualityColor[0], qualityColor[1], qualityColor[2], 210);
        g.roundRect(cx, cy, cardW, 60, 6);
        g.fill();
        g.strokeColor = new Color(255, 255, 255, 90);
        g.lineWidth = 1;
        g.roundRect(cx, cy, cardW, 60, 6);
        g.stroke();
        lbl(cx + cardW / 2, cy + 38, this.formatEquipment(reward.item), 15, new Color(245, 248, 255));
        lbl(cx + cardW / 2, cy + 16, `${SLOT_LABEL[reward.item.slot]} → ${reward.target}`, 13, new Color(245, 248, 255));
    }

    private drawButton(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        y: number,
        w: number,
        h: number,
        text: string,
        kind: CraftHot['kind'],
        enabled: boolean,
    ): void {
        const rect = this.pressRect(x, y, w, h, enabled && this.pressedKind === kind);
        g.fillColor = enabled ? new Color(67, 76, 96, 245) : new Color(48, 52, 62, 200);
        g.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
        g.fill();
        g.strokeColor = enabled ? new Color(140, 200, 255, 220) : new Color(90, 94, 104, 180);
        g.lineWidth = 2;
        g.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
        g.stroke();
        lbl(x + w / 2, y + h / 2, text, 18, enabled ? new Color(245, 248, 255) : new Color(145, 150, 160));
        if (enabled) this.hots.push({ x, y, w, h, kind });
    }

    private async craftSelectedEquipment(): Promise<void> {
        if (this.options.availableEquipmentSlots() < 1) {
            this.message = '背包/仓库空间不足，无法合成';
            this.render();
            return;
        }
        const result = craftEquipment(this.options.getMaterials(), this.ensureSelectedTier(), this.selectedSlot, Math.random);
        if (!result.ok || !result.item || !result.remainingMaterials) {
            this.message = result.reason ?? '合成失败';
            this.render();
            return;
        }
        const placed = this.options.addEquipment([result.item]);
        if (placed.failed > 0 || placed.received.length === 0) {
            this.message = '装备入库失败，材料未消耗';
            this.render();
            return;
        }
        await this.options.persist(result.remainingMaterials);
        this.lastResult = placed.received[0];
        this.message = `合成成功：${this.formatEquipment(this.lastResult.item)}（进${this.lastResult.target}）`;
        this.render();
    }

    private formatEquipment(item: EquipItem): string {
        return `Lv.${item.level ?? 1} ${QUALITY_LABEL[item.quality]}·${item.name}`;
    }

    private pressRect(x: number, y: number, w: number, h: number, pressed: boolean): { x: number; y: number; w: number; h: number } {
        if (!pressed) return { x, y, w, h };
        const dw = w * (1 - PRESS_SCALE);
        const dh = h * (1 - PRESS_SCALE);
        return { x: x + dw / 2, y: y + dh / 2, w: w - dw, h: h - dh };
    }

    private hit(e: EventTouch): CraftHot | null {
        if (!this.isOpen()) return null;
        const ui = e.getUILocation();
        const p = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        return this.hots.find(hot => p.x >= hot.x && p.x <= hot.x + hot.w && p.y >= hot.y && p.y <= hot.y + hot.h) ?? null;
    }

    private onTouchStart(e: EventTouch): void {
        if (!this.isOpen()) return;
        e.propagationStopped = true;
        const hit = this.hit(e);
        this.pressedKind = hit?.kind ?? null;
        this.pressedTierId = hit?.tierId ?? '';
        this.pressedSlot = hit?.slot ?? null;
        if (this.pressedKind) this.render();
    }

    private onTouchMove(e: EventTouch): void {
        if (!this.pressedKind) return;
        const hit = this.hit(e);
        if (hit?.kind === this.pressedKind && (hit.tierId ?? '') === this.pressedTierId && (hit.slot ?? null) === this.pressedSlot) return;
        this.clearPressed();
        this.render();
    }

    private onTouchCancel(): void {
        if (!this.pressedKind) return;
        this.clearPressed();
        this.render();
    }

    private onTouchEnd(e: EventTouch): void {
        if (!this.isOpen()) return;
        e.propagationStopped = true;
        const hit = this.hit(e);
        if (this.pressedKind) {
            this.clearPressed();
            this.render();
        }
        if (!hit) return;
        if (hit.kind === 'close') this.hide();
        else if (hit.kind === 'tier' && hit.tierId) {
            this.selectedTier = hit.tierId;
            this.message = '';
            this.render();
        } else if (hit.kind === 'slot' && hit.slot) {
            this.selectedSlot = hit.slot;
            this.message = '';
            this.render();
        } else if (hit.kind === 'craft') {
            void this.craftSelectedEquipment();
        }
    }

    private clearPressed(): void {
        this.pressedKind = null;
        this.pressedTierId = '';
        this.pressedSlot = null;
    }
}
