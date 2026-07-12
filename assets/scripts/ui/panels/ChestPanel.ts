import { Color, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { BattleConfig } from '../../config/BattleConfig';
import { QUALITY_COLOR, QUALITY_LABEL, SLOT_LABEL } from '../../inventory/EquipDefs';
import type { EquipItem } from '../../inventory/EquipDefs';
import type { ChestInventoryModel, ChestItem } from '../../chest/ChestModel';
import { chestTypeLabel, openChest } from '../../chest/ChestService';
import { MATERIAL_LABEL } from '../../services/RewardTypes';
import type { MaterialItem } from '../../services/RewardTypes';
import type { RewardEntry } from '../UiTypes';

interface ChestHot {
    x: number;
    y: number;
    w: number;
    h: number;
    kind: 'open' | 'close' | 'select';
    chestId?: string;
}

interface ChestOpenDisplay {
    chestLabel: string;
    received: RewardEntry[];
    materials: MaterialItem[];
}

export interface ChestPanelOptions {
    host: Node;
    halfW: number;
    halfH: number;
    getChests: () => ChestInventoryModel;
    availableEquipmentSlots: () => number;
    addEquipment: (items: EquipItem[]) => { received: RewardEntry[]; failed: number };
    commitOpen: (chest: ChestItem, materials: MaterialItem[]) => Promise<void>;
    onNotice: (message: string) => void;
    beforeShow: () => void;
    qualityBonus?: () => number;   // 心法掉落支加成（组合根注入；缺省 0）
}

const PRESS_SCALE = 0.94;

export class ChestPanel {
    private readonly root: Node;
    private readonly gfx: Graphics;
    private readonly labels: Label[] = [];
    private readonly hots: ChestHot[] = [];
    private pressedKind: ChestHot['kind'] | null = null;
    private pressedChestId = '';
    private selectedChestId = '';
    private message = '';
    private lastOpen: ChestOpenDisplay | null = null;

    constructor(private readonly options: ChestPanelOptions) {
        this.root = new Node('ChestView');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);

        const gfxNode = new Node('ChestGfx');
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
        this.ensureSelectedChest();
        this.root.active = true;
        this.root.setSiblingIndex(this.options.host.children.length - 1);
        this.render();
    }

    hide(): void {
        this.root.active = false;
        this.pressedKind = null;
        this.pressedChestId = '';
    }

    refresh(): void {
        if (this.isOpen()) this.render();
    }

    destroy(): void {
        this.root.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.root.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.root.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.root.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    private labelAt(i: number): Label {
        while (i >= this.labels.length) {
            const node = new Node('ChestLbl');
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
        const selected = this.ensureSelectedChest();
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
        g.strokeColor = new Color(255, 226, 126, 205);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8);
        g.stroke();

        const chests = this.options.getChests();
        lbl(0, y + h - 42, `宝箱库存：${chests.chests.length}/${chests.maxChests}`, 30, new Color(255, 226, 126));
        if (chests.chests.length === 0) {
            lbl(0, y + h - 118, '暂无宝箱，战斗和离线会自动积累', 20, new Color(190, 198, 214));
        } else {
            lbl(0, y + h - 82, this.chestCountsText(), 18, new Color(190, 220, 190));
            this.drawChestList(g, lbl, x + 28, y + h - 132, 292, 54);
            this.drawSelectedChest(g, lbl, x + 350, y + h - 132, w - 378, 146, selected);
        }
        this.drawOpenResult(g, lbl, x + 28, y + 118, w - 56, 210);
        if (this.message) lbl(0, y + 90, this.message, 17, new Color(255, 210, 150));
        this.drawButton(g, lbl, x + 70, y + 40, 180, 50, '开启选中', 'open', !!selected);
        this.drawButton(g, lbl, x + w - 250, y + 40, 180, 50, '关闭', 'close', true);
        for (let i = li; i < this.labels.length; i++) this.labels[i].node.active = false;
    }

    private ensureSelectedChest(): ChestItem | null {
        const chests = this.options.getChests().chests;
        if (chests.length === 0) {
            this.selectedChestId = '';
            return null;
        }
        const selected = chests.find(chest => chest.id === this.selectedChestId);
        if (selected) return selected;
        this.selectedChestId = chests[0].id;
        return chests[0];
    }

    private drawChestList(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        rowH: number,
    ): void {
        lbl(x + w / 2, topY + 22, '选择宝箱', 20, new Color(230, 232, 238));
        const chests = this.options.getChests().chests;
        const maxRows = 3;
        const list = chests.slice(0, maxRows);
        for (let i = 0; i < list.length; i++) {
            const chest = list[i];
            const y = topY - 34 - i * (rowH + 8);
            const selected = chest.id === this.selectedChestId;
            const pressed = this.pressedKind === 'select' && this.pressedChestId === chest.id;
            const rect = this.pressRect(x, y, w, rowH, pressed);
            g.fillColor = selected ? new Color(72, 82, 104, 245) : new Color(43, 48, 60, 235);
            g.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
            g.fill();
            g.strokeColor = selected ? new Color(255, 226, 126, 230) : new Color(88, 96, 112, 190);
            g.lineWidth = selected ? 3 : 2;
            g.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
            g.stroke();
            const levelName = BattleConfig.levels[chest.sourceLevelIndex]?.name ?? `第 ${chest.sourceLevelIndex + 1} 关`;
            lbl(x + 70, y + rowH / 2 + 8, chestTypeLabel(chest.type), 17, new Color(245, 248, 255));
            lbl(x + w - 92, y + rowH / 2 + 8, levelName, 14, new Color(180, 188, 204));
            lbl(x + w / 2, y + rowH / 2 - 13, chest.sourceDropGroup, 13, new Color(150, 158, 178));
            this.hots.push({ x, y, w, h: rowH, kind: 'select', chestId: chest.id });
        }
        const remain = chests.length - list.length;
        if (remain > 0) lbl(x + w / 2, topY - 34 - maxRows * (rowH + 8) + 18, `另有 ${remain} 个，开启前列宝箱后继续显示`, 14, new Color(165, 174, 192));
    }

    private drawSelectedChest(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        h: number,
        chest: ChestItem | null,
    ): void {
        g.fillColor = new Color(35, 39, 50, 235);
        g.roundRect(x, topY - h, w, h, 8);
        g.fill();
        g.strokeColor = new Color(88, 96, 112, 190);
        g.lineWidth = 2;
        g.roundRect(x, topY - h, w, h, 8);
        g.stroke();
        lbl(x + w / 2, topY - 28, '当前选中', 20, new Color(230, 232, 238));
        if (!chest) {
            lbl(x + w / 2, topY - 78, '暂无可开启宝箱', 17, new Color(170, 178, 194));
            return;
        }
        const levelName = BattleConfig.levels[chest.sourceLevelIndex]?.name ?? `第 ${chest.sourceLevelIndex + 1} 关`;
        const preview = openChest(chest, this.options.qualityBonus?.() ?? 0);
        const equipmentCount = preview.reward?.equipments.length ?? 0;
        const materials = this.formatMaterials(preview.reward?.materials ?? []);
        lbl(x + w / 2, topY - 62, `${chestTypeLabel(chest.type)} · ${levelName}`, 20, new Color(255, 226, 126));
        lbl(x + w / 2, topY - 94, `预计：装备 ${equipmentCount} 件  材料 ${materials || '无'}`, 15, new Color(205, 214, 232));
        lbl(x + w / 2, topY - 122, `空间：${this.options.availableEquipmentSlots()} / 需要 ${equipmentCount}`, 15, new Color(170, 220, 180));
    }

    private drawOpenResult(
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
        lbl(x + w / 2, y + h - 28, '本次开箱奖励', 20, new Color(230, 232, 238));
        if (!this.lastOpen) {
            lbl(x + w / 2, y + h / 2 - 8, '开启宝箱后在这里查看奖励明细', 17, new Color(165, 174, 192));
            return;
        }
        const result = this.lastOpen;
        lbl(x + w / 2, y + h - 62, `${result.chestLabel}：装备 ${result.received.length} 件  材料 ${this.formatMaterials(result.materials) || '无'}`, 17, new Color(255, 226, 126));
        const items = result.received.slice(0, 6);
        const cardW = Math.min(176, (w - 56) / 3);
        for (let i = 0; i < items.length; i++) {
            const reward = items[i];
            const cx = x + 28 + (i % 3) * (cardW + 10);
            const cy = y + h - 130 - Math.floor(i / 3) * 58;
            const qualityColor = QUALITY_COLOR[reward.item.quality];
            g.fillColor = new Color(qualityColor[0], qualityColor[1], qualityColor[2], 210);
            g.roundRect(cx, cy, cardW, 46, 6);
            g.fill();
            g.strokeColor = new Color(255, 255, 255, 90);
            g.lineWidth = 1;
            g.roundRect(cx, cy, cardW, 46, 6);
            g.stroke();
            lbl(cx + cardW / 2, cy + 28, `Lv.${reward.item.level ?? 1} ${QUALITY_LABEL[reward.item.quality]} · ${reward.item.name}`, 14, new Color(245, 248, 255));
            lbl(cx + cardW / 2, cy + 12, `${SLOT_LABEL[reward.item.slot]} → ${reward.target}`, 12, new Color(245, 248, 255));
        }
        if (result.received.length > items.length) lbl(x + w / 2, y + 18, `另有 ${result.received.length - items.length} 件装备已入库`, 14, new Color(190, 198, 214));
    }

    private chestCountsText(): string {
        const counts: Record<string, number> = { normal: 0, boss: 0, chapter: 0 };
        for (const chest of this.options.getChests().chests) counts[chest.type] = (counts[chest.type] ?? 0) + 1;
        return `普通 ${counts.normal}  ·  Boss ${counts.boss}  ·  章节 ${counts.chapter}`;
    }

    private drawButton(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        y: number,
        w: number,
        h: number,
        text: string,
        kind: ChestHot['kind'],
        enabled: boolean,
    ): void {
        const rect = this.pressRect(x, y, w, h, enabled && this.pressedKind === kind);
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

    private async openSelectedChest(): Promise<void> {
        const chest = this.ensureSelectedChest();
        if (!chest) {
            this.message = '暂无可开启宝箱';
            this.render();
            return;
        }
        const result = openChest(chest, this.options.qualityBonus?.() ?? 0);
        if (!result.ok || !result.reward) {
            this.message = result.reason ?? '开箱失败';
            this.render();
            return;
        }
        const reward = result.reward;
        if (reward.equipments.length > this.options.availableEquipmentSlots()) {
            this.message = '背包/仓库空间不足，无法开箱';
            this.render();
            return;
        }
        const received = this.options.addEquipment(reward.equipments);
        if (received.failed > 0) {
            this.message = '装备入库失败，宝箱未消耗';
            this.render();
            return;
        }

        await this.options.commitOpen(chest, reward.materials);
        this.selectedChestId = this.options.getChests().chests[0]?.id ?? '';
        this.lastOpen = {
            chestLabel: chestTypeLabel(chest.type),
            received: received.received,
            materials: reward.materials,
        };
        const materialText = this.formatMaterials(reward.materials);
        this.message = `开启${chestTypeLabel(chest.type)}：${received.received.length} 件装备${materialText ? `，${materialText}` : ''}`;
        this.options.onNotice(this.message);
        this.render();
    }

    private formatMaterials(materials: MaterialItem[], maxParts = 3): string {
        const visible = materials.filter(material => material.count > 0);
        if (visible.length === 0) return '';
        const parts = visible
            .slice(0, maxParts)
            .map(material => `${MATERIAL_LABEL[material.id]} +${material.count}`);
        const extra = visible.length > maxParts ? ` 等${visible.length}种` : '';
        return parts.join('、') + extra;
    }

    private pressRect(x: number, y: number, w: number, h: number, pressed: boolean): { x: number; y: number; w: number; h: number } {
        if (!pressed) return { x, y, w, h };
        const dw = w * (1 - PRESS_SCALE);
        const dh = h * (1 - PRESS_SCALE);
        return { x: x + dw / 2, y: y + dh / 2, w: w - dw, h: h - dh };
    }

    private hit(e: EventTouch): ChestHot | null {
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
        this.pressedChestId = hit?.chestId ?? '';
        if (this.pressedKind) this.render();
    }

    private onTouchMove(e: EventTouch): void {
        if (!this.pressedKind) return;
        const hit = this.hit(e);
        if (hit?.kind === this.pressedKind && (hit.chestId ?? '') === this.pressedChestId) return;
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
        else if (hit.kind === 'select' && hit.chestId) {
            this.selectedChestId = hit.chestId;
            this.message = '';
            this.render();
        } else if (hit.kind === 'open') {
            void this.openSelectedChest();
        }
    }

    private clearPressed(): void {
        this.pressedKind = null;
        this.pressedChestId = '';
    }
}
