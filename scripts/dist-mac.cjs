#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const pkg = require(path.join(rootDir, 'package.json'));
const args = new Set(process.argv.slice(2));

const outputDir = path.join(rootDir, pkg.build?.directories?.output || 'release');
const productName = pkg.build?.productName || pkg.productName || pkg.name;
const version = pkg.version;
const arch = process.env.npm_config_arch || process.env.ARCH || process.arch;
const appPath = path.join(outputDir, `mac-${arch}`, `${productName}.app`);
const dmgPath = path.join(outputDir, `${productName}-${version}-${arch}.dmg`);

main();

function main() {
  if (process.platform !== 'darwin') {
    fail('macOS packaging must be run on macOS.');
  }

  if (!args.has('--dmg-only')) {
    const builderArgs = args.has('--dir-only') ? ['--dir'] : ['--mac', 'zip'];
    runElectronBuilder(builderArgs);
  }

  if (!args.has('--dir-only') && !args.has('--zip-only')) {
    createDmg();
  }
}

function runElectronBuilder(builderArgs) {
  const builderBin = path.join(
    rootDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
  );

  if (!fs.existsSync(builderBin)) {
    fail('electron-builder is not installed. Run `corepack pnpm install` first.');
  }

  const env = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || 'false',
    PATH: withPnpmShim(process.env.PATH || '')
  };

  run(builderBin, builderArgs, { env });
}

function createDmg() {
  if (!fs.existsSync(appPath)) {
    fail(`Packaged app was not found: ${appPath}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  run('hdiutil', ['create', '-volname', productName, '-srcfolder', appPath, '-ov', '-format', 'UDZO', dmgPath]);
}

function withPnpmShim(currentPath) {
  if (commandWorks('pnpm', ['--version'])) {
    return currentPath;
  }

  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xixi-pnpm-'));
  const shimPath = path.join(shimDir, 'pnpm');
  const npmExecPath = process.env.npm_execpath;
  const corepackPath = findOnPath('corepack', currentPath);

  let command;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    command = `exec ${quote(process.execPath)} ${quote(npmExecPath)} "$@"`;
  } else if (corepackPath) {
    command = `exec ${quote(corepackPath)} pnpm "$@"`;
  } else {
    return currentPath;
  }

  fs.writeFileSync(shimPath, `#!/bin/sh\n${command}\n`, { mode: 0o755 });
  return `${shimDir}${path.delimiter}${currentPath}`;
}

function commandWorks(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'ignore' });
  return result.status === 0;
}

function findOnPath(command, currentPath) {
  for (const dir of currentPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options
  });

  if (result.error) {
    fail(result.error.message);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function quote(value) {
  return `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
