import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

// 避免重复截断被 Windows 扫描器映射的生成文件；变更内容通过同目录原子替换发布。
export async function writeGeneratedOutputs(outputFiles) {
  for (const { path, contents } of outputFiles) {
    try {
      if ((await readFile(path)).equals(Buffer.from(contents))) continue
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    try {
      await writeFile(temporary, contents)
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
  }
}
