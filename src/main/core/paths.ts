import * as fs from 'node:fs'
import * as path from 'node:path'

export interface Dirs {
  /** 程序数据根目录（默认 electron userData） */
  root: string
  tmpDir: string
  /** Node.js 各版本解压目录（node-vX 子目录） */
  runtimeDir: string
  /** DSH / pnpm 的 npm 全局安装前缀 */
  prefixDir: string
  logsDir: string
  /** 升级系统 DSH 前的备份目录 */
  backupDir: string
  settingsFile: string
}

export function resolveDirs(root: string): Dirs {
  return {
    root,
    tmpDir: path.join(root, 'tmp'),
    runtimeDir: path.join(root, 'runtime'),
    prefixDir: path.join(root, 'prefix'),
    logsDir: path.join(root, 'logs'),
    backupDir: path.join(root, 'backup'),
    settingsFile: path.join(root, 'settings.json')
  }
}

export function ensureDirs(dirs: Dirs): void {
  for (const d of [dirs.root, dirs.tmpDir, dirs.runtimeDir, dirs.prefixDir, dirs.logsDir, dirs.backupDir]) {
    fs.mkdirSync(d, { recursive: true })
  }
}

/** Node 官方 Windows 包架构后缀：arm64 机器对应 win-arm64，其余均为 win-x64 */
export function nodeWinArch(arch: string = process.arch): string {
  return arch === 'arm64' ? 'arm64' : 'x64'
}

/**
 * 目标 Node 版本解压目录（node-v<version>-win-<arch>）。
 * 优先精确匹配当前架构的官方命名；未命中时前缀匹配 runtimeDir 中
 * node-v<version>* 残留目录（兼容无 -win-<arch> 后缀的手动放置目录、
 * 以及其他架构后缀的已有目录）；均未命中时返回官方命名（与下载/解压
 * 使用的 zip 根目录名一致）。
 */
export function nodeDistDir(dirs: Dirs, version: string): string {
  const official = `node-v${version}-win-${nodeWinArch()}`
  const exact = path.join(dirs.runtimeDir, official)
  if (fs.existsSync(exact)) return exact
  try {
    const found = fs
      .readdirSync(dirs.runtimeDir)
      .filter((n) => n.startsWith(`node-v${version}`))
      .sort()
    if (found.length > 0) return path.join(dirs.runtimeDir, found[0])
  } catch {
    // runtime 目录尚未创建；下载解压后即命中官方命名
  }
  return exact
}

export function nodeExe(dirs: Dirs, version: string): string {
  return path.join(nodeDistDir(dirs, version), 'node.exe')
}

export function npmCliJs(dirs: Dirs, version: string): string {
  return path.join(nodeDistDir(dirs, version), 'node_modules', 'npm', 'bin', 'npm-cli.js')
}

export function dshEntry(dirs: Dirs): string {
  return path.join(dirs.prefixDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}