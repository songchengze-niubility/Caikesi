import { Color, EditBox, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { normalizeAccountId } from '../../core/data/AccountService';

interface AccountHot {
    rect: { x: number; y: number; w: number; h: number };
    act: () => void;
}

export interface AccountPanelOptions {
    host: Node;
    halfW: number;
    halfH: number;
    currentAccount: () => string;
    listAccounts: () => string[];
    switchAccount: (id: string) => Promise<void>;
    onSwitched: () => void;
}

export class AccountPanel {
    private readonly root: Node;
    private readonly gfx: Graphics;
    private readonly edit: EditBox;
    private readonly labels: Label[] = [];
    private readonly hots: AccountHot[] = [];
    private hint = '';
    private switching = false;

    constructor(private readonly options: AccountPanelOptions) {
        this.root = new Node('AccountView');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);

        const gfxNode = new Node('AccountGfx');
        gfxNode.layer = this.root.layer;
        gfxNode.addComponent(UITransform);
        this.gfx = gfxNode.addComponent(Graphics);
        this.root.addChild(gfxNode);

        const editNode = new Node('AccountInput');
        editNode.layer = this.root.layer;
        editNode.addComponent(UITransform).setContentSize(360, 60);

        const textNode = new Node('TEXT_LABEL');
        textNode.layer = this.root.layer;
        textNode.addComponent(UITransform).setContentSize(340, 52);
        const textLabel = textNode.addComponent(Label);
        textLabel.fontSize = 26;
        textLabel.color = new Color(58, 48, 36);
        editNode.addChild(textNode);

        const placeholderNode = new Node('PLACEHOLDER_LABEL');
        placeholderNode.layer = this.root.layer;
        placeholderNode.addComponent(UITransform).setContentSize(340, 52);
        const placeholder = placeholderNode.addComponent(Label);
        placeholder.fontSize = 26;
        placeholder.color = new Color(150, 140, 125);
        placeholder.string = '输入账号名';
        editNode.addChild(placeholderNode);

        this.edit = editNode.addComponent(EditBox);
        this.edit.textLabel = textLabel;
        this.edit.placeholderLabel = placeholder;
        this.edit.maxLength = 20;
        this.root.addChild(editNode);
        editNode.setPosition(0, 340, 0);

        options.host.addChild(this.root);
        this.root.active = false;
        this.root.on(Node.EventType.TOUCH_START, this.swallowTouch, this);
        this.root.on(Node.EventType.TOUCH_END, this.onTap, this);
    }

    open(): void {
        this.hint = '';
        this.switching = false;
        this.edit.string = this.options.currentAccount();
        this.root.active = true;
        this.root.setSiblingIndex(this.options.host.children.length - 1);
        this.render();
    }

    hide(): void {
        this.root.active = false;
    }

    destroy(): void {
        this.root.off(Node.EventType.TOUCH_START, this.swallowTouch, this);
        this.root.off(Node.EventType.TOUCH_END, this.onTap, this);
    }

    private labelAt(i: number): Label {
        while (i >= this.labels.length) {
            const node = new Node('AccountLbl');
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
        const label = (text: string, x: number, y: number, size = 24, color?: Color) => {
            const item = this.labelAt(li++);
            item.node.active = true;
            item.string = text;
            item.fontSize = size;
            item.color = color ?? new Color(235, 228, 210);
            item.node.setPosition(x, y, 0);
        };

        g.fillColor = new Color(20, 24, 30, 230);
        g.rect(-this.options.halfW, -this.options.halfH, this.options.halfW * 2, this.options.halfH * 2);
        g.fill();
        label('切换账号', 0, 470, 30);
        label('账号将用于记录你的存档（将来接后端同步）', 0, 425, 20, new Color(160, 152, 138));

        g.fillColor = new Color(238, 230, 210, 255);
        g.roundRect(-180, 310, 360, 60, 8);
        g.fill();
        if (this.hint) {
            label(this.hint, 0, 262, 20, this.switching ? new Color(180, 176, 165) : new Color(220, 90, 80));
        }

        const list = this.options.listAccounts().slice(0, 6);
        label('本机账号（点选填入）', 0, 210, 22, new Color(160, 152, 138));
        const rowH = 72;
        const x0 = -240;
        const rowW = 480;
        let y = 150;
        for (const id of list) {
            const current = id === this.options.currentAccount();
            g.fillColor = current ? new Color(64, 84, 66, 255) : new Color(48, 58, 72, 255);
            g.roundRect(x0, y - rowH / 2, rowW, rowH - 10, 10);
            g.fill();
            label(current ? `${id}（当前）` : id, 0, y, 24);
            this.hots.push({
                rect: { x: x0, y: y - rowH / 2, w: rowW, h: rowH - 10 },
                act: () => { this.edit.string = id; },
            });
            y -= rowH;
        }

        g.fillColor = new Color(74, 96, 76, 255);
        g.roundRect(-220, -560, 200, 70, 12);
        g.fill();
        label('确认', -120, -525, 26);
        this.hots.push({ rect: { x: -220, y: -560, w: 200, h: 70 }, act: () => { void this.confirm(); } });

        g.fillColor = new Color(120, 60, 60, 255);
        g.roundRect(20, -560, 200, 70, 12);
        g.fill();
        label('取消', 120, -525, 26);
        this.hots.push({ rect: { x: 20, y: -560, w: 200, h: 70 }, act: () => this.hide() });
    }

    private async confirm(): Promise<void> {
        const id = normalizeAccountId(this.edit.string);
        if (!id) {
            this.hint = '账号名需 1~20 字：中英文/数字/下划线';
            this.render();
            return;
        }
        if (id === this.options.currentAccount()) {
            this.hide();
            return;
        }
        this.switching = true;
        this.hint = '读取存档中...';
        this.render();
        await this.options.switchAccount(id);
        this.switching = false;
        this.hide();
        this.options.onSwitched();
    }

    private swallowTouch(e: EventTouch): void {
        e.propagationStopped = true;
    }

    private onTap(e: EventTouch): void {
        e.propagationStopped = true;
        if (this.switching) return;
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
