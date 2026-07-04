// 美术完整性校验：对照 ArtManifest，逐条查 assets/resources/<path>.png 是否存在。
// 序列帧(frames)条目额外校验 .png.meta：
//   - sprite-frame 子 meta 必须 trimType=custom 且尺寸=PNG 实际尺寸（否则 SizeMode.CUSTOM 下逐帧裁切不同会拉伸/抖动，
//     即 2026-07 修过的 attack_18 bug；新目录首次经 Cocos 导入默认 trimType=auto 就会触发）；
//   - 同一动作全部帧必须同尺寸（游戏侧按第一帧算显示框）。
//   - 缺 .meta 只警告（「人工一步」的 Cocos 编辑器导入还没做），错 .meta 直接失败。
// 修复方式：sprite-keyframe UI 里对该目录跑一次「修补 meta」，或重新覆盖导入。
// Codex 提交美术后跑一次（npm run check:art），立刻知道有没有漏文件/坏 meta。
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ArtManifest, entryFiles } from '../assets/scripts/art/ArtManifest';

const RES = resolve(__dirname, '../assets/resources');
const missing: string[] = [];
const badMeta: string[] = [];
const noMeta: string[] = [];
const sizeMix: string[] = [];

// 从 PNG 文件头（IHDR）读宽高，不引第三方依赖
function pngSize(file: string): { w: number; h: number } | null {
    const buf = readFileSync(file);
    // 签名 8 字节 + IHDR 块头 8 字节，宽高各 4 字节大端
    if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452 /* 'IHDR' */) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// 校验一帧的 sprite-frame meta；返回错误描述，null 表示通过
function checkFrameMeta(metaFile: string, w: number, h: number): string | null {
    let data: any;
    try {
        data = JSON.parse(readFileSync(metaFile, 'utf-8'));
    } catch {
        return 'meta 不是合法 JSON';
    }
    let ud: any = null;
    for (const sub of Object.values<any>(data.subMetas ?? {})) {
        if (sub?.importer === 'sprite-frame') { ud = sub.userData ?? null; break; }
    }
    if (!ud) return '缺 sprite-frame 子 meta';
    if (ud.trimType !== 'custom') return `trimType=${ud.trimType ?? 'auto'}（应为 custom）`;
    if (ud.width !== w || ud.height !== h || ud.rawWidth !== w || ud.rawHeight !== h) {
        return `meta 尺寸 ${ud.width}×${ud.height}/raw ${ud.rawWidth}×${ud.rawHeight} ≠ PNG ${w}×${h}`;
    }
    if (ud.trimX !== 0 || ud.trimY !== 0 || ud.offsetX !== 0 || ud.offsetY !== 0) {
        return `trim/offset 非 0（trim ${ud.trimX},${ud.trimY} offset ${ud.offsetX},${ud.offsetY}）`;
    }
    return null;
}

for (const [key, entry] of Object.entries(ArtManifest)) {
    let firstSize: { w: number; h: number } | null = null;
    for (const p of entryFiles(entry)) {
        const png = resolve(RES, p + '.png');
        if (!existsSync(png)) {
            missing.push(`${key} → resources/${p}.png`);
            continue;
        }
        if (entry.type !== 'frames') continue;

        const size = pngSize(png);
        if (!size) {
            badMeta.push(`${key} → ${p}.png：无法解析 PNG 头`);
            continue;
        }
        if (!firstSize) firstSize = size;
        else if (size.w !== firstSize.w || size.h !== firstSize.h) {
            sizeMix.push(`${key} → ${p}.png：${size.w}×${size.h} ≠ 首帧 ${firstSize.w}×${firstSize.h}`);
        }

        const metaFile = png + '.meta';
        if (!existsSync(metaFile)) {
            noMeta.push(`${key} → ${p}.png.meta`);
            continue;
        }
        const err = checkFrameMeta(metaFile, size.w, size.h);
        if (err) badMeta.push(`${key} → ${p}.png：${err}`);
    }
}

if (noMeta.length) {
    console.warn(`⚠ ${noMeta.length} 帧还没有 .meta（开一次 Cocos 编辑器导入，然后跑「修补 meta」）：`);
    for (const m of noMeta.slice(0, 10)) console.warn('  - ' + m);
    if (noMeta.length > 10) console.warn(`  …另有 ${noMeta.length - 10} 条`);
}

const errors = missing.length + badMeta.length + sizeMix.length;
if (errors) {
    if (missing.length) {
        console.error(`❌ 缺 ${missing.length} 个美术文件：`);
        for (const m of missing) console.error('  - ' + m);
    }
    if (sizeMix.length) {
        console.error(`❌ ${sizeMix.length} 帧与同动作首帧尺寸不一致（会导致显示框计算错误）：`);
        for (const m of sizeMix) console.error('  - ' + m);
    }
    if (badMeta.length) {
        console.error(`❌ ${badMeta.length} 帧 .meta 不合规（SizeMode.CUSTOM 下会拉伸/抖动）：`);
        for (const m of badMeta) console.error('  - ' + m);
    }
    process.exit(1);
}
console.log(`✓ 美术齐全：${Object.keys(ArtManifest).length} 个逻辑键，文件与序列帧 .meta 全部合规${noMeta.length ? `（${noMeta.length} 帧待 Cocos 导入生成 .meta）` : ''}`);
