// 根据最终收集的依赖生成许可证清单；缺失的文本明确记录，不能静默省略。
const fs = require('node:fs');
const path = require('node:path');

const NOTICE_FILE = /^(?:LICEN[CS]E|COPYING|NOTICE|COPYRIGHT)(?:[._-].*)?$/i;
const LICENSE_FILE = /^(?:LICEN[CS]E|COPYING)(?:[._-].*)?$/i;

function frontendPackages(projectDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
  const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }));
  const seeds = new Set();
  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(filename);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|vue|s?css)$/.test(entry.name)) {
        const text = fs.readFileSync(filename, 'utf8');
        for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"'\n]+)["']/g)) {
          const name = match[1].startsWith('@') ? match[1].split('/').slice(0, 2).join('/') : match[1].split('/')[0];
          if (declared.has(name)) seeds.add(name);
        }
      }
    }
  }
  scan(path.join(projectDir, 'src'));
  function resolvePackage(name, from) {
    let dir = from;
    while (dir === projectDir || dir.startsWith(projectDir + path.sep)) {
      const candidate = path.join(dir, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
      dir = path.dirname(dir);
    }
    return null;
  }
  const queue = [...seeds].map(name => ({ name, from: projectDir }));
  const found = new Set();
  while (queue.length) {
    const { name, from } = queue.shift();
    const dir = resolvePackage(name, from);
    if (!dir || found.has(dir)) continue;
    found.add(dir);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) queue.push({ name: dep, from: dir });
  }
  return [...found];
}

function packageDirectories(nm, result = []) {
  if (!fs.existsSync(nm)) return result;
  for (const entry of fs.readdirSync(nm, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(nm, entry.name);
    if (entry.name.startsWith('@')) {
      for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!child.isDirectory()) continue;
        const pkg = path.join(dir, child.name);
        if (fs.existsSync(path.join(pkg, 'package.json'))) result.push(pkg);
        packageDirectories(path.join(pkg, 'node_modules'), result);
      }
    } else {
      if (fs.existsSync(path.join(dir, 'package.json'))) result.push(dir);
      packageDirectories(path.join(dir, 'node_modules'), result);
    }
  }
  return result;
}

function noticeTexts(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && NOTICE_FILE.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => ({ file: entry.name, text: fs.readFileSync(path.join(dir, entry.name), 'utf8').trim() }))
    .filter(entry => entry.text);
}

function sourcePackage(sourceNm, packagedNm, dir, pkg) {
  for (const candidate of [path.join(sourceNm, path.relative(packagedNm, dir)), path.join(sourceNm, pkg.name || '')]) {
    try {
      const source = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8'));
      if (source.name === pkg.name && source.version === pkg.version) return candidate;
    } catch {}
  }
  return null;
}

function stageThirdPartyNotices({ projectDir, resourcesDir, appBundleDir, platform, officeNoticesFile }) {
  const projectLicense = fs.readFileSync(path.join(projectDir, 'LICENSE'), 'utf8');
  const officeNotices = fs.readFileSync(officeNoticesFile, 'utf8');
  const chromium = path.join(appBundleDir, 'LICENSES.chromium.html');
  if (platform !== 'darwin' && !fs.existsSync(chromium)) {
    throw new Error('[notices] LICENSES.chromium.html is missing from the packaged Electron runtime');
  }
  const packagedNm = path.join(resourcesDir, 'app', 'node_modules');
  const sourceNm = path.join(projectDir, 'node_modules');
  const frontend = frontendPackages(projectDir);
  const seen = new Set();
  const missingTexts = [];
  let out = 'Happy Friday Lite — Third-Party Software Notices\n\n';
  out += 'The application license is LICENSE-Friday.txt in this directory.\n';
  out += 'Chromium notices are LICENSES.chromium.html in the application installation directory\n';
  out += '(on macOS, inside the Electron framework). Office notices and bundled fonts follow below.\n\n';
  out += '=== Collected application and bundled frontend npm dependencies ===\n';
  for (const dir of [...packageDirectories(packagedNm).sort(), ...frontend.sort()]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || 'not declared';
    out += `\n--- ${key} — ${license} ---\n`;
    const texts = new Map(noticeTexts(dir.startsWith(sourceNm + path.sep) ? dir : sourcePackage(sourceNm, packagedNm, dir, pkg)).map(entry => [entry.file, entry.text]));
    // 产物中的实际文本优先；构建白名单移除的 .md 从相同版本源包补回。
    for (const entry of noticeTexts(dir)) texts.set(entry.file, entry.text);
    if (![...texts.keys()].some(file => LICENSE_FILE.test(file))) {
      missingTexts.push({ name: pkg.name, version: pkg.version, license });
      out += 'No license/notice text was published in the installed package.\n';
      const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
      if (repository) out += `${repository}\n`;
    }
    for (const [file, value] of [...texts].sort(([a], [b]) => a.localeCompare(b))) out += `\n${file}\n${value}\n`;
  }
  out += '\n=== Office, native sidecar, fonts and Unicode notices ===\n';
  out += officeNotices.replace('see LICENSES.chromium.html next to this file', 'see LICENSES.chromium.html in the application installation directory');
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(path.join(resourcesDir, 'LICENSE-Friday.txt'), projectLicense);
  fs.writeFileSync(path.join(resourcesDir, 'THIRD-PARTY-NOTICES.txt'), out);
  const report = { npmPackages: seen.size, bundledFrontendPackages: frontend.length, missingTexts, chromiumPreserved: platform === 'darwin' ? null : true };
  fs.writeFileSync(path.join(resourcesDir, 'third-party-notices-audit.json'), JSON.stringify(report, null, 2));
  return report;
}

module.exports = { stageThirdPartyNotices };
