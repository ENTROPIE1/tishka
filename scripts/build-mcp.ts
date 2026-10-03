import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function main(): void {
  const mcpRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'mcp-servers');
  const require = createRequire(import.meta.url);
  // у typescript 7 экспортируется только ./package.json, сам компилятор лежит в lib/tsc.js
  const tscPackage = dirname(require.resolve('typescript/package.json'));
  const tsc = join(tscPackage, 'lib', 'tsc.js');

  let failed = false;
  for (const entry of readdirSync(mcpRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const config = join(mcpRoot, entry.name, 'tsconfig.json');
    if (!existsSync(config)) {
      continue;
    }
    console.log(`Сборка ${entry.name}...`);
    const result = spawnSync(process.execPath, [tsc, '-p', config], { stdio: 'inherit' });
    if (result.status !== 0) {
      failed = true;
    }
  }
  process.exitCode = failed ? 1 : 0;
}

main();
