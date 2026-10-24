import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { shareNetworkAddresses } from '../../src-electron/share-network.js'
import { prepareClipboardShareFiles, removeClipboardShareDirectory } from '../../src-electron/clipboard-share-files.js'
import { createClipboardShare, revokeClipboardShare, revokeClipboardResourceShares, startShareServer, stopShareServer } from '../../src-electron/shareServer.js'

test('分享网卡优先实体局域网地址，保留 VPN 备选，离线明确回环地址', () => {
  const ipv4 = address => ({ address, family: 'IPv4', internal: false })
  const addresses = shareNetworkAddresses({ 'Clash TUN': [ipv4('198.18.0.1')], 'vEthernet (WSL)': [ipv4('172.25.0.1')], 'Wi-Fi': [ipv4('192.168.1.20')], Loopback: [{ ...ipv4('127.0.0.1'), internal: true }] })
  assert.equal(addresses[0].address, '192.168.1.20')
  assert.equal(addresses.length, 3)
  assert.equal(shareNetworkAddresses({})[0].address, '127.0.0.1')
})

test('独立线程完整打包中文目录、空目录和多文件夹；源内容保持原样', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-share-source-'))
  let prepared
  try {
    const first = path.join(source, '学习 资料'), second = path.join(source, '另一目录')
    await fs.mkdir(path.join(first, '空目录'), { recursive: true }); await fs.mkdir(second)
    await fs.writeFile(path.join(first, '笔记.txt'), '原始内容')
    await fs.writeFile(path.join(second, '数据.bin'), Buffer.from([0, 255, 12]))
    const stages = []
    prepared = await prepareClipboardShareFiles([first, second], { onProgress: event => stages.push(event.stage) })
    assert.equal(prepared.folderCount, 2)
    const zip = new AdmZip(prepared.files[0])
    assert.equal(zip.readAsText('学习 资料/笔记.txt'), '原始内容')
    assert.ok(zip.getEntry('学习 资料/空目录/').isDirectory)
    assert.deepEqual(new AdmZip(prepared.files[1]).readFile('另一目录/数据.bin'), Buffer.from([0, 255, 12]))
    assert.equal(await fs.readFile(path.join(first, '笔记.txt'), 'utf8'), '原始内容')
    assert.ok(stages.includes('collecting')); assert.ok(stages.includes('archiving'))
  } finally { await removeClipboardShareDirectory(prepared?.directory); await fs.rm(source, { recursive: true, force: true }) }
})

test('打包超限、缺失及目录联接明确失败，不静默分享残缺文件夹', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-share-limits-'))
  try {
    await fs.writeFile(path.join(source, '内容.txt'), '超过单次测试容量')
    await assert.rejects(prepareClipboardShareFiles([source], { maxBytes: 2 }), /FOLDER_TOO_LARGE/)
    await assert.rejects(prepareClipboardShareFiles([source], { maxEntries: 1 }), /FOLDER_TOO_LARGE/)
    await assert.rejects(prepareClipboardShareFiles([path.join(source, 'missing')]), /FILE_MISSING/)
    await fs.symlink(source, path.join(source, '循环链接'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(prepareClipboardShareFiles([source]), /LINK_UNSUPPORTED/)
  } finally { await fs.rm(source, { recursive: true, force: true }) }
})

test('文件图片内嵌预览，文件夹 ZIP 可下载还原，撤销与资源删除使链接失效', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-share-http-'))
  try {
    const folder = path.join(source, '资料'), image = path.join(source, '预览.webp')
    await fs.mkdir(folder); await fs.writeFile(path.join(folder, '笔记.txt'), '扫码可读取的内容'); await fs.writeFile(image, 'image-fixture')
    await startShareServer()
    const share = await createClipboardShare({ resourceId: 'folder-one', filePaths: [image, folder] })
    assert.equal(share.folderCount, 1); assert.equal(share.omittedFiles, 0); assert.ok(share.urls.length)
    const url = new URL(share.url); url.hostname = '127.0.0.1'
    const response = await fetch(url), html = await response.text()
    assert.ok(html.includes('<img loading="lazy"')); assert.ok(html.includes('.zip'))
    assert.equal((await fetch(url.href + '/file/0')).headers.get('content-type'), 'image/webp')
    const archive = await fetch(url.href + '/file/1?download=1')
    assert.ok(archive.headers.get('content-disposition').includes('.zip'))
    const zip = new AdmZip(Buffer.from(await archive.arrayBuffer()))
    assert.equal(zip.readAsText('资料/笔记.txt'), '扫码可读取的内容')
    revokeClipboardResourceShares('folder-one')
    assert.equal((await fetch(url)).status, 404)
    assert.equal((await fetch(url.href + '/file/1')).status, 404)
    const regular = await createClipboardShare({ text: '可撤销' })
    assert.equal(revokeClipboardShare(regular.token), true)
    assert.equal(revokeClipboardShare(regular.token), false)
    await assert.rejects(createClipboardShare({ filePaths: [path.join(source, 'missing')] }), /FILE_MISSING/)
  } finally { stopShareServer(); await fs.rm(source, { recursive: true, force: true }) }
})

test('过期链接和关闭服务均不可继续读取分享', async () => {
  const originalNow = Date.now
  try {
    await startShareServer()
    const share = await createClipboardShare({ text: '有期限的分享' })
    const url = new URL(share.url); url.hostname = '127.0.0.1'
    Date.now = () => Date.parse(share.expiresAt) + 1
    assert.equal((await fetch(url)).status, 404)
    Date.now = originalNow
    stopShareServer()
    assert.equal(await createClipboardShare({ text: '服务已停止' }), null)
  } finally { Date.now = originalNow; stopShareServer() }
})
