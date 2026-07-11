import { Color, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import type { GemType } from '../../inventory/EquipDefs';
import { QUALITY_LABEL, STAT_LABEL, formatStatValue } from '../../inventory/EquipDefs';
import type { EquipItem } from '../../inventory/EquipDefs';
import type { InventoryModel } from '../../inventory/InventoryModel';
import { applyInscription, socketGem, unsocketGem } from '../../inlay/InlayModel';
import { gemMaxLevel, gemTypes, socketCounts } from '../../inlay/InlayConfig';
import { MATERIAL_LABEL, gemMaterialId } from '../../services/RewardTypes';
import type { MaterialSave } from '../../services/RewardTypes';

interface InlayHot {
    rect: { x: number; y: number; w: number; h: number };
    act: () => void;
}

export interface InlayPanelOptions {
    host: Node;
    halfW: number;
    halfH: number;
    getInventory: () => InventoryModel;
    getMaterials: () => MaterialSave;
    beforeOpen: () => void;
    persist: () => Promise<void>;
}

export class InlayPanel {
    private readonly root: Node;
    private readonly gfx: Graphics;
    private readonly labels: Label[] = [];
    private readonly hots: InlayHot[] = [];
    private itemId: string | null = null;
    private selectedSocket: number | null = null;
    private message = '';

    constructor(private readonly options: InlayPanelOptions) {
        this.root = new Node('InlayView');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);

        const gfxNode = new Node('InlayGfx');
        gfxNode.layer = this.root.layer;
        gfxNode.addComponent(UITransform);
        this.gfx = gfxNode.addComponent(Graphics);
        this.root.addChild(gfxNode);
        options.host.addChild(this.root);
        this.root.active = false;
        this.root.on(Node.EventType.TOUCH_END, this.onTap, this);
    }

    open(itemId: string): void {
        this.itemId = itemId;
        this.selectedSocket = null;
        this.message = '';
        this.options.beforeOpen();
        this.root.active = true;
        this.root.setSiblingIndex(this.options.host.children.length - 1);
        this.render();
    }

    hide(): void {
        this.root.active = false;
    }

    destroy(): void {
        this.root.off(Node.EventType.TOUCH_END, this.onTap, this);
    }

    private labelAt(i: number): Label {
        while (i >= this.labels.length) {
            const node = new Node('InlayLbl');
            node.layer = this.root.layer;
            node.addComponent(UITransform);
            const label = node.addComponent(Label);
            this.root.addChild(node);
            this.labels.push(label);
        }
        return this.labels[i];
    }

    private item(): EquipItem | null {
        if (!this.itemId) return null;
        const inventory = this.options.getInventory();
        return inventory.backpack.find(item => item.id === this.itemId)
            ?? inventory.warehouse.find(item => item.id === this.itemId)
            ?? null;
    }

    private render(): void {
        const g = this.gfx;
        g.clear();
        this.hots.length = 0;
        for (const label of this.labels) label.node.active = false;
        let li = 0;
        const label = (text: string, x: number, y: number, size = 22, color?: Color) => {
            const item = this.labelAt(li++);
            item.node.active = true;
            item.string = text;
            item.fontSize = size;
            if (color) item.color = color;
            item.node.setPosition(x, y, 0);
        };

        g.fillColor = new Color(20, 24, 30, 235);
        g.rect(-this.options.halfW, -this.options.halfH, this.options.halfW * 2, this.options.halfH * 2);
        g.fill();

        const equipment = this.item();
        if (!equipment) {
            label('装备不存在（可能已穿戴/售出）', 0, 0, 24);
            this.pushClose();
            return;
        }
        label(`镶嵌  ${QUALITY_LABEL[equipment.quality]} · ${equipment.name}`, 0, 600, 28);
        if (this.message) label(this.message, 0, 552, 20, new Color(255, 200, 120));

        const counts = socketCounts(equipment.quality);
        let y = 470;
        label('宝石孔（点空孔选中→点下方宝石镶入；点已镶取出）', 0, y + 40, 20, new Color(180, 210, 255));
        for (let i = 0; i < counts.gemSockets; i++) {
            const gem = equipment.gemSockets?.[i] ?? null;
            const selected = this.selectedSocket === i;
            g.fillColor = selected ? new Color(72, 110, 150, 245) : new Color(48, 58, 72, 255);
            g.roundRect(-300, y - 40, 600, 72, 10);
            g.fill();
            const text = gem
                ? `孔${i + 1}：${MATERIAL_LABEL[gemMaterialId(gem.type, gem.level)]}（点取出）`
                : `孔${i + 1}：空${selected ? '（已选中）' : '（点选中）'}`;
            label(text, 0, y - 4, 22);
            const index = i;
            this.hots.push({ rect: { x: -300, y: y - 40, w: 600, h: 72 }, act: () => this.onSocketTap(index) });
            y -= 84;
        }

        y -= 20;
        label('铭文位（点“打铭文”消耗卷轴随机抽/覆盖）', 0, y + 40, 20, new Color(200, 180, 255));
        for (let i = 0; i < counts.inscriptionSlots; i++) {
            const inscription = equipment.inscriptions?.[i] ?? null;
            g.fillColor = new Color(48, 58, 72, 255);
            g.roundRect(-300, y - 40, 440, 72, 10);
            g.fill();
            const text = inscription
                ? `位${i + 1}：${STAT_LABEL[inscription.stat]}+${formatStatValue(inscription.stat, inscription.value)}`
                : `位${i + 1}：空`;
            label(text, -80, y - 4, 22);
            g.fillColor = new Color(120, 90, 160, 255);
            g.roundRect(160, y - 40, 140, 72, 10);
            g.fill();
            label('打铭文', 230, y - 4, 22);
            const index = i;
            this.hots.push({ rect: { x: 160, y: y - 40, w: 140, h: 72 }, act: () => this.onInscribeTap(index) });
            y -= 84;
        }

        y -= 20;
        label('持有宝石（先选空孔再点这里镶入）', 0, y + 40, 20, new Color(180, 255, 200));
        const materials = this.options.getMaterials();
        const held: { type: GemType; level: number; id: ReturnType<typeof gemMaterialId>; count: number }[] = [];
        for (const type of gemTypes()) {
            for (let level = 1; level <= gemMaxLevel(type); level++) {
                const id = gemMaterialId(type, level);
                const count = materials[id] ?? 0;
                if (count > 0) held.push({ type, level, id, count });
            }
        }
        if (held.length === 0) label('（暂无宝石，去开宝箱）', 0, y - 4, 20, new Color(160, 168, 184));
        held.slice(0, 6).forEach((gem, index) => {
            const bx = -300 + (index % 3) * 205;
            const by = y - Math.floor(index / 3) * 70;
            g.fillColor = new Color(40, 70, 55, 255);
            g.roundRect(bx, by - 30, 195, 60, 8);
            g.fill();
            label(`${MATERIAL_LABEL[gem.id]}×${gem.count}`, bx + 97, by, 18);
            this.hots.push({ rect: { x: bx, y: by - 30, w: 195, h: 60 }, act: () => this.onGemTap(gem.type, gem.level) });
        });

        this.pushClose();
    }

    private pushClose(): void {
        this.gfx.fillColor = new Color(120, 60, 60, 255);
        this.gfx.roundRect(-90, -600, 180, 70, 12);
        this.gfx.fill();
        const label = this.labelAt(this.labels.filter(item => item.node.active).length);
        label.node.active = true;
        label.string = '关闭';
        label.fontSize = 26;
        label.node.setPosition(0, -565, 0);
        this.hots.push({ rect: { x: -90, y: -600, w: 180, h: 70 }, act: () => this.hide() });
    }

    private onSocketTap(index: number): void {
        const equipment = this.item();
        if (!equipment) return;
        const gem = equipment.gemSockets?.[index] ?? null;
        if (gem) {
            const result = unsocketGem(equipment, index, this.options.getMaterials());
            this.message = result.ok ? '已取出宝石' : (result.reason ?? '取出失败');
            if (result.ok) {
                void this.persistAndRender();
                return;
            }
        } else {
            this.selectedSocket = index;
            this.message = `已选中孔${index + 1}，点下方宝石镶入`;
        }
        this.render();
    }

    private onGemTap(type: GemType, level: number): void {
        const equipment = this.item();
        if (!equipment) return;
        if (this.selectedSocket === null) {
            this.message = '先点上方一个空孔';
            this.render();
            return;
        }
        const result = socketGem(equipment, this.selectedSocket, type, level, this.options.getMaterials());
        this.message = result.ok ? '已镶入宝石' : (result.reason ?? '镶入失败');
        if (result.ok) {
            this.selectedSocket = null;
            void this.persistAndRender();
        } else {
            this.render();
        }
    }

    private onInscribeTap(index: number): void {
        const equipment = this.item();
        if (!equipment) return;
        const result = applyInscription(equipment, index, this.options.getMaterials(), Math.random);
        this.message = result.ok ? '已打入铭文' : (result.reason ?? '打铭文失败');
        if (result.ok) void this.persistAndRender();
        else this.render();
    }

    private async persistAndRender(): Promise<void> {
        await this.options.persist();
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
