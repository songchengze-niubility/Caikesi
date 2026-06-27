// 生成占位 PNG（纯色块），让资源管线能端到端跑通；真图后续由 Codex 替换。
// 序列帧逐帧改变亮度，导入预览时能看出动画在循环。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ArtManifest, entryFiles } from '../assets/scripts/art/ArtManifest';

const RES = resolve(__dirname, '../assets/resources');

// —— 最小 PNG 编码（RGBA，无压缩优化，够用）——
const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td), 0);
    return Buffer.concat([len, td, crc]);
}
function solidPng(w: number, h: number, r: number, g: number, b: number): Buffer {
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
    const raw = Buffer.alloc(h * (1 + w * 4));
    for (let y = 0; y < h; y++) {
        const row = y * (1 + w * 4); raw[row] = 0; // filter 0
        for (let x = 0; x < w; x++) { const o = row + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255; }
    }
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function write(pathNoExt: string, png: Buffer) {
    const full = resolve(RES, pathNoExt + '.png'); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, png);
}

// 每个逻辑键一个基色
const BASE: Record<string, [number, number, number]> = {
    'bg/main': [120, 160, 210],
    'char/tank/idle': [70, 170, 200], 'char/dps/idle': [255, 150, 60], 'char/healer/idle': [90, 220, 120],
};
let count = 0;
for (const [key, entry] of Object.entries(ArtManifest)) {
    const [r, g, b] = BASE[key] ?? [200, 200, 200];
    const files = entryFiles(entry);
    files.forEach((p, i) => {
        const k = files.length > 1 ? 0.7 + 0.3 * (i / (files.length - 1)) : 1; // 逐帧变亮
        write(p, solidPng(64, 64, Math.round(r * k), Math.round(g * k), Math.round(b * k)));
        count++;
    });
}
console.log(`✓ 生成 ${count} 张占位 PNG 到 assets/resources/art/`);
