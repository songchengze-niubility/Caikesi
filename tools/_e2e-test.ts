// 端到端自测：模拟策划改 Excel → 重新导出 → 确认产物更新。测完恢复原值。
import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const XLSX_PATH = resolve(__dirname, 'config-xlsx/battle.xlsx');
const TEST_VAL = 999;

// 1) 改 Stats!B2（tank 的 hp）从 360 → TEST_VAL
const wb = XLSX.read(readFileSync(XLSX_PATH));
const ws = wb.Sheets['Stats'];
console.log('改前 B2 (tank hp):', ws['B2']?.v);
ws['B2'] = { t: 'n', v: TEST_VAL };
writeFileSync(XLSX_PATH, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
console.log(`已把 tank hp 改成 ${TEST_VAL}，重新导出...`);

// 2) 跑导出脚本
execSync('npx tsx tools/excel-to-config.ts', { stdio: 'inherit' });

// 3) 检查 generated.ts 是否含 TEST_VAL
const gen = readFileSync(resolve(__dirname, '../assets/scripts/config/battle.config.generated.ts'), 'utf-8');
// 产物是 JSON.stringify 结果，key 带引号（"tank" / "hp"），正则必须匹配带引号形式。
const m = gen.match(/"tank":\s*\{[\s\S]*?"hp":\s*(\d+)/);
const newHp = m ? Number(m[1]) : NaN;
console.log('generated.ts 里 tank.hp =', newHp);

// 4) 恢复原值 360
const wb2 = XLSX.read(readFileSync(XLSX_PATH));
wb2.Sheets['Stats']['B2'] = { t: 'n', v: 360 };
writeFileSync(XLSX_PATH, XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
execSync('npx tsx tools/excel-to-config.ts', { stdio: 'inherit' });
console.log('已恢复 tank hp = 360 并重新导出。');

if (newHp === TEST_VAL) {
    console.log('\n✅ 端到端自测通过：改 Excel → npm run config → 产物正确更新。');
    process.exit(0);
} else {
    console.error('\n❌ 端到端自测失败：产物未反映改动。');
    process.exit(1);
}
