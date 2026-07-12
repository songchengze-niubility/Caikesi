import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { inflateSync } from 'node:zlib';

interface AlphaStats {
    width: number;
    height: number;
    colorType: number;
    bitDepth: number;
    minAlpha: number;
    maxAlpha: number;
    transparentRatio: number;
    partialRatio: number;
}

const ROOT = 'assets/resources/art/ui';

// 这些图自身就是完整面板，允许是实心矩形；新增例外必须写理由。
const OPAQUE_OK: Record<string, string> = {
    'battle/nav/nav_bar_full.png': '底部导航整条面板，背景本身就是组件。',
    'battle/stage/chapter_banner.png': '章节标题纸条，纸面本身就是组件。',
    'battle/stage/reward_card.png': '右上奖励卡，卡片纸面本身就是组件。',
    'boot/background.png': '启动流完整背景底图，本身就是全屏画面。',
    'main/equipment-panel-background.png': '主界面下半装备区完整宣纸面板，本身就是全矩形组件。',
};

function readUInt(buffer: Buffer, offset: number): number {
    return buffer.readUInt32BE(offset);
}

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

function alphaStats(file: string): AlphaStats {
    const buffer = readFileSync(file);
    if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error(`${file} 不是 PNG`);
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idat: Buffer[] = [];

    while (offset < buffer.length) {
        const length = readUInt(buffer, offset);
        const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = readUInt(data, 0);
            height = readUInt(data, 4);
            bitDepth = data[8];
            colorType = data[9];
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        offset += 12 + length;
    }

    if (bitDepth !== 8) throw new Error(`${file} 暂只支持 8-bit PNG，当前 bitDepth=${bitDepth}`);
    const channelsByType: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
    const channels = channelsByType[colorType];
    if (!channels) throw new Error(`${file} 暂不支持 PNG colorType=${colorType}`);

    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    let rawOffset = 0;
    let prev = Buffer.alloc(stride);
    let minAlpha = 255;
    let maxAlpha = 0;
    let transparent = 0;
    let partial = 0;
    const total = width * height;

    for (let y = 0; y < height; y++) {
        const filter = raw[rawOffset++];
        const row = raw.subarray(rawOffset, rawOffset + stride);
        rawOffset += stride;
        const out = Buffer.alloc(stride);

        for (let i = 0; i < stride; i++) {
            const left = i >= channels ? out[i - channels] : 0;
            const up = prev[i] ?? 0;
            const upLeft = i >= channels ? prev[i - channels] : 0;
            let value = row[i];
            if (filter === 1) value = (value + left) & 255;
            else if (filter === 2) value = (value + up) & 255;
            else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 255;
            else if (filter === 4) value = (value + paeth(left, up, upLeft)) & 255;
            else if (filter !== 0) throw new Error(`${file} 遇到未知 PNG filter=${filter}`);
            out[i] = value;
        }

        for (let x = 0; x < width; x++) {
            const alpha = colorType === 6 ? out[x * channels + 3]
                : colorType === 4 ? out[x * channels + 1]
                : 255;
            minAlpha = Math.min(minAlpha, alpha);
            maxAlpha = Math.max(maxAlpha, alpha);
            if (alpha === 0) transparent++;
            else if (alpha < 255) partial++;
        }
        prev = out;
    }

    return {
        width,
        height,
        colorType,
        bitDepth,
        minAlpha,
        maxAlpha,
        transparentRatio: transparent / total,
        partialRatio: partial / total,
    };
}

const checks = [
    'battle/hud/profile_cluster.png',
    'battle/hud/resource_energy_full.png',
    'battle/hud/resource_gold_full.png',
    'battle/hud/resource_jade_full.png',
    'battle/nav/nav_bar_full.png',
    'battle/skills/skill_01.png',
    'battle/skills/skill_02.png',
    'battle/skills/skill_03.png',
    'battle/stage/chapter_banner.png',
    'battle/stage/reward_card.png',
    'battle/stage/wave_progress.png',
    'boot/background.png',
    'boot/loading_ring.png',
    'boot/loading_progress.png',
    'boot/bottom_fade.png',
    'boot/notice.png',
    'boot/title.png',
    'boot/start_button.png',
    'boot/age_rating.png',
    'main/hud-avatar-frame.png',
    'main/hud-power-plaque.png',
    'main/hud-chapter-wave.png',
    'main/hud-currency-gold.png',
    'main/hud-currency-gem.png',
    'main/skill-sword.png',
    'main/skill-bow.png',
    'main/skill-heal.png',
    'main/equipment-panel-background.png',
    'main/captain-card.png',
    'main/equipment-slot.png',
    'main/character-switch-tray.png',
    'main/stats-strip.png',
    'main/change-equipment-button.png',
    'main/nav-bar.png',
    'main/nav-button-main-selected.png',
    'main/nav-button-squad-normal.png',
    'main/nav-button-bag-normal.png',
    'main/nav-button-character-normal.png',
    'main/nav-button-rune-normal.png',
];

let failed = false;
for (const rel of checks) {
    const file = join(ROOT, rel);
    if (!existsSync(file)) {
        console.error(`✗ 缺少 UI 资源：${file}`);
        failed = true;
        continue;
    }
    const stats = alphaStats(file);
    const shown = relative('.', file).replaceAll('\\', '/');
    const transparent = `${(stats.transparentRatio * 100).toFixed(1)}%`;
    const partial = `${(stats.partialRatio * 100).toFixed(1)}%`;
    const allowOpaqueReason = OPAQUE_OK[rel];
    if (!allowOpaqueReason && stats.transparentRatio < 0.01 && stats.partialRatio < 0.01) {
        console.error(`✗ ${shown} 没有透明像素，疑似带入示意图背景`);
        failed = true;
        continue;
    }
    const suffix = allowOpaqueReason ? `（允许不透明：${allowOpaqueReason}）` : '';
    console.log(`✓ ${shown} ${stats.width}x${stats.height} transparent=${transparent} partial=${partial}${suffix}`);
}

if (failed) process.exit(1);
