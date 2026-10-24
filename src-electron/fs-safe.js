import fs from 'node:fs'
import path from 'node:path'

// Electron 42 的 fs.rmSync({ recursive:true }) 在 Windows 上会穿透
// junction。逐层 lstat，只 unlink 链接，绝不递归进入它指向的目录。
// root 必须由调用者明确给出；禁止删除边界本身或沿中间链接访问外部路径。
function checkedRemovalTarget(target, root) {
  if (!root || !target) throw new Error('删除操作必须指定目标和所属目录')
  const boundary = path.resolve(root)
  const absolute = path.resolve(target)
  const relative = path.relative(boundary, absolute)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('删除目标超出所属目录')
  }
  let ancestor = path.dirname(absolute)
  while (path.relative(boundary, ancestor) !== '') {
    try {
      if (fs.lstatSync(ancestor).isSymbolicLink()) throw new Error('删除路径的父级包含目录链接')
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    ancestor = path.dirname(ancestor)
  }
  return absolute
}

export function removePathNoFollowSync(target, { root } = {}) {
  const absolute = checkedRemovalTarget(target, root)
  if (!absolute) return
  function remove(filename) {
    let stat
    try { stat = fs.lstatSync(filename) } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fs.unlinkSync(filename)
      return
    }
    for (const name of fs.readdirSync(filename)) remove(path.join(filename, name))
    fs.rmdirSync(filename)
  }
  remove(absolute)
}

// 分享归档等后台清理使用异步版本，避免阻塞主进程。
export async function removePathNoFollow(target, { root } = {}) {
  const absolute = checkedRemovalTarget(target, root)
  if (!absolute) return
  async function remove(filename) {
    let stat
    try { stat = await fs.promises.lstat(filename) } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      await fs.promises.unlink(filename)
      return
    }
    for (const name of await fs.promises.readdir(filename)) await remove(path.join(filename, name))
    await fs.promises.rmdir(filename)
  }
  await remove(absolute)
}
