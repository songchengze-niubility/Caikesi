import { Node, Sprite, SpriteFrame, UIOpacity, UITransform } from 'cc';
import type { ArtRegistry } from '../art/ArtRegistry';

interface LayerSpec {
    name: string;
    key: string;
    sourceTop: number;
    speed: number;
    opacity?: number;
    drift?: number;
}

interface RuntimeLayer {
    spec: LayerSpec;
    nodes: Node[];
    tileW: number;
}

const SOURCE_W = 1149;
const SOURCE_GROUND_Y = 1048;
const MARCH_SCROLL_SPEED = 220;

const LAYERS: LayerSpec[] = [
    { name: 'Sky', key: 'bg/main-v02/sky', sourceTop: 0, speed: 0 },
    { name: 'Far', key: 'bg/main-v02/far', sourceTop: 368, speed: 0.12 },
    { name: 'Mid', key: 'bg/main-v02/mid', sourceTop: 411, speed: 0.28 },
    { name: 'Mist', key: 'bg/main-v02/mist', sourceTop: 436, speed: 0.18, opacity: 72, drift: 8 },
    { name: 'Ground', key: 'bg/main-v02/ground', sourceTop: 1048, speed: 0.62 },
    { name: 'Foreground', key: 'bg/main-v02/foreground', sourceTop: 972, speed: 1 },
];

export const PARALLAX_BACKGROUND_KEYS = LAYERS.map(layer => layer.key);

export class ParallaxBackgroundView {
    readonly root: Node;
    private readonly runtime: RuntimeLayer[] = [];
    private scroll = 0;
    private driftTime = 0;

    constructor(
        host: Node,
        private readonly width: number,
        private readonly art: ArtRegistry<SpriteFrame>,
    ) {
        this.root = new Node('ParallaxBackground');
        this.root.layer = host.layer;
        this.root.addComponent(UITransform).setContentSize(width, width * 1.25);
        this.root.active = false;
        host.addChild(this.root);
    }

    build(): boolean {
        this.root.removeAllChildren();
        this.runtime.length = 0;
        const frames: SpriteFrame[] = [];
        for (const layer of LAYERS) {
            const frame = this.art.getSprite(layer.key);
            if (!frame) return false;
            frames.push(frame);
        }

        const scale = this.width / SOURCE_W;
        const fullTopY = SOURCE_GROUND_Y * scale;
        for (let i = 0; i < LAYERS.length; i++) {
            const spec = LAYERS[i];
            const frame = frames[i];
            const displayW = frame.rect.width * scale;
            const displayH = frame.rect.height * scale;
            const y = fullTopY - (spec.sourceTop + frame.rect.height / 2) * scale;
            const count = spec.speed === 0 ? 1 : 3;
            const nodes: Node[] = [];
            for (let tile = 0; tile < count; tile++) {
                const node = new Node(`${spec.name}_${tile}`);
                node.layer = this.root.layer;
                node.addComponent(UITransform).setContentSize(displayW, displayH);
                const sprite = node.addComponent(Sprite);
                sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                sprite.spriteFrame = frame;
                if (spec.opacity != null) node.addComponent(UIOpacity).opacity = spec.opacity;
                if (tile % 2 === 1 && count > 1) node.setScale(-1, 1, 1);
                node.setPosition(0, y, 0);
                this.root.addChild(node);
                nodes.push(node);
            }
            this.runtime.push({ spec, nodes, tileW: displayW });
        }
        this.root.active = true;
        this.reset();
        return true;
    }

    reset(): void {
        this.scroll = 0;
        this.driftTime = 0;
        this.positionLayers();
    }

    update(dt: number, marching: boolean): void {
        if (!this.root.active) return;
        if (marching) this.scroll += MARCH_SCROLL_SPEED * dt;
        this.driftTime += dt;
        this.positionLayers();
    }

    private positionLayers(): void {
        for (const layer of this.runtime) {
            if (layer.nodes.length === 1) {
                layer.nodes[0].setPosition(0, layer.nodes[0].position.y, 0);
                continue;
            }
            const drift = (layer.spec.drift ?? 0) * this.driftTime;
            const raw = this.scroll * layer.spec.speed + drift;
            const offset = ((raw % layer.tileW) + layer.tileW) % layer.tileW;
            const firstCenter = -layer.tileW / 2 - offset;
            for (let i = 0; i < layer.nodes.length; i++) {
                const node = layer.nodes[i];
                node.setPosition(firstCenter + i * layer.tileW, node.position.y, 0);
            }
        }
    }
}
