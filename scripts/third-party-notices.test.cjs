const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { stageThirdPartyNotices } = require('./third-party-notices.cjs');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friday-notices-'));
  const { removePathNoFollowSync } = await import('../src-electron/fs-safe.js');
  t.after(() => removePathNoFollowSync(root, { root: os.tmpdir() }));
  const projectDir = path.join(root, 'project');
  const appBundleDir = path.join(root, 'packaged');
  const resourcesDir = path.join(appBundleDir, 'resources');
  const officeNoticesFile = path.join(projectDir, 'office-notices.txt');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'LICENSE'), 'FRIDAY LICENSE\r\n');
  fs.writeFileSync(path.join(projectDir, 'package.json'), '{}');
  fs.writeFileSync(path.join(appBundleDir, 'LICENSES.chromium.html'), '<html>CHROMIUM ORIGINAL</html>');
  fs.writeFileSync(officeNoticesFile, 'OFFICE LICENSES\nsee LICENSES.chromium.html next to this file\nFONT LICENSE\nRUST LICENSE\n');
  return { root, projectDir, appBundleDir, resourcesDir, officeNoticesFile, platform: 'win32' };
}

function pkg(nm, name, version = '1.0.0') {
  const dir = path.join(nm, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, license: 'MIT' }));
  return dir;
}

test('release notices retain Chromium bytes and recover excluded license markdown from exact source versions', async t => {
  const f = await fixture(t);
  const packagedNm = path.join(f.resourcesDir, 'app/node_modules');
  const sourceNm = path.join(f.projectDir, 'node_modules');
  pkg(packagedNm, '@scope/a');
  const source = pkg(sourceNm, '@scope/a');
  fs.writeFileSync(path.join(source, 'LICENSE.md'), 'A REQUIRED COPYRIGHT');
  fs.writeFileSync(path.join(source, 'NOTICE'), 'A ATTRIBUTION');
  const nested = pkg(path.join(packagedNm, '@scope/a/node_modules'), 'b');
  fs.writeFileSync(path.join(nested, 'COPYING.txt'), 'B REQUIRED COPYRIGHT');
  const result = stageThirdPartyNotices(f);
  assert.equal(result.npmPackages, 2);
  assert.deepEqual(result.missingTexts, []);
  const output = fs.readFileSync(path.join(f.resourcesDir, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
  for (const required of ['A REQUIRED COPYRIGHT', 'A ATTRIBUTION', 'B REQUIRED COPYRIGHT', 'FONT LICENSE', 'RUST LICENSE']) assert.ok(output.includes(required));
  assert.ok(!output.includes('next to this file'));
  assert.equal(fs.readFileSync(path.join(f.appBundleDir, 'LICENSES.chromium.html'), 'utf8'), '<html>CHROMIUM ORIGINAL</html>');
  assert.equal(fs.readFileSync(path.join(f.resourcesDir, 'LICENSE-Friday.txt'), 'utf8'), 'FRIDAY LICENSE\r\n');
});

test('missing license text is reported without borrowing another source version or hiding the package', async t => {
  const f = await fixture(t);
  pkg(path.join(f.resourcesDir, 'app/node_modules'), 'missing', '2.0.0');
  const old = pkg(path.join(f.projectDir, 'node_modules'), 'missing', '1.0.0');
  fs.writeFileSync(path.join(old, 'LICENSE'), 'INCORRECT OLD LICENSE');
  const result = stageThirdPartyNotices(f);
  assert.deepEqual(result.missingTexts, [{ name: 'missing', version: '2.0.0', license: 'MIT' }]);
  const output = fs.readFileSync(path.join(f.resourcesDir, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
  assert.ok(output.includes('missing@2.0.0'));
  assert.ok(!output.includes('INCORRECT OLD LICENSE'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.resourcesDir, 'third-party-notices-audit.json'), 'utf8')), result);
});

test('Windows package without Chromium notices is rejected before writing a completion report', async t => {
  const f = await fixture(t);
  fs.unlinkSync(path.join(f.appBundleDir, 'LICENSES.chromium.html'));
  assert.throws(() => stageThirdPartyNotices(f), /Chromium|chromium/);
  assert.equal(fs.existsSync(path.join(f.resourcesDir, 'third-party-notices-audit.json')), false);
});

test('dependency inventory does not traverse a directory link outside the packaged tree', async t => {
  const f = await fixture(t);
  const nm = path.join(f.resourcesDir, 'app/node_modules');
  const outside = pkg(path.join(f.root, 'external/node_modules'), 'outside');
  fs.writeFileSync(path.join(outside, 'LICENSE'), 'EXTERNAL PRIVATE FIXTURE');
  fs.mkdirSync(nm, { recursive: true });
  fs.symlinkSync(outside, path.join(nm, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = stageThirdPartyNotices(f);
  assert.equal(result.npmPackages, 0);
  assert.ok(!fs.readFileSync(path.join(f.resourcesDir, 'THIRD-PARTY-NOTICES.txt'), 'utf8').includes('EXTERNAL PRIVATE FIXTURE'));
});

test('Vue bundles include frontend devDependencies and their runtime closure even without packaged node_modules copies', async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.projectDir, 'package.json'), JSON.stringify({ devDependencies: { vue: '1', vite: '1' } }));
  fs.mkdirSync(path.join(f.projectDir, 'src'));
  fs.writeFileSync(path.join(f.projectDir, 'src/App.vue'), '<script setup>import { ref } from "vue"</script>');
  const nm = path.join(f.projectDir, 'node_modules');
  const vue = pkg(nm, 'vue');
  fs.writeFileSync(path.join(vue, 'package.json'), JSON.stringify({ name: 'vue', version: '1.0.0', dependencies: { '@vue/shared': '1' } }));
  fs.writeFileSync(path.join(vue, 'LICENSE'), 'VUE COPYRIGHT');
  fs.writeFileSync(path.join(pkg(nm, '@vue/shared'), 'LICENSE'), 'VUE SHARED COPYRIGHT');
  fs.writeFileSync(path.join(pkg(nm, 'vite'), 'LICENSE'), 'BUILD TOOL ONLY');
  const result = stageThirdPartyNotices(f);
  assert.equal(result.bundledFrontendPackages, 2);
  assert.equal(result.npmPackages, 2);
  const output = fs.readFileSync(path.join(f.resourcesDir, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
  assert.ok(output.includes('VUE COPYRIGHT') && output.includes('VUE SHARED COPYRIGHT'));
  assert.ok(!output.includes('BUILD TOOL ONLY'));
});

test('attribution NOTICE alone does not conceal a missing license text', async t => {
  const f = await fixture(t);
  const dir = pkg(path.join(f.resourcesDir, 'app/node_modules'), 'notice-only');
  fs.writeFileSync(path.join(dir, 'NOTICE'), 'ATTRIBUTION ONLY');
  const result = stageThirdPartyNotices(f);
  assert.equal(result.missingTexts[0].name, 'notice-only');
  assert.ok(fs.readFileSync(path.join(f.resourcesDir, 'THIRD-PARTY-NOTICES.txt'), 'utf8').includes('ATTRIBUTION ONLY'));
});
