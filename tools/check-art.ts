// 美术完整性校验：对照 ArtManifest，逐条查 assets/resources/<path>.png 是否存在。
// Codex 提交美术后跑一次（npm run check:art），立刻知道有没有漏文件。
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ArtManifest, entryFiles } from '../assets/scripts/art/ArtManifest';

const RES = resolve(__dirname, '../assets/resources');
const missing: string[] = [];
for (const [key, entry] of Object.entries(ArtManifest)) {
    for (const p of entryFiles(entry)) {
        if (!existsSync(resolve(RES, p + '.png'))) missing.push(`${key} → resources/${p}.png`);
    }
}
if (missing.length) {
    console.error(`❌ 缺 ${missing.length} 个美术文件：`);
    for (const m of missing) console.error('  - ' + m);
    process.exit(1);
}
console.log(`✓ 美术齐全：${Object.keys(ArtManifest).length} 个逻辑键，全部文件就位`);
