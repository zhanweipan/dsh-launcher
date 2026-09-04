import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import extract from 'extract-zip'
import { downloadFile, fetchText, sha256File } from './net'
import type { Dirs } from './paths'
import { nodeDistDir, nodeExe, nodeWinArch } from './paths'
import type { LogHub } from './logger'

export interface InstallEnv {
  dirs: Dirs
  log: LogHub
  registry: string
  nodeVersion: string
}

export interface ProgressCb {
  (phase: string, percent: number | null, message: string): void
}

const NODE_DIST = 'https://nodejs.org/dist'

/**
 * 确保 Node.js 就绪：
 * 1. 若目标版本已存在且可用则跳过
 * 2. 下载官方 Windows zip（按当前架构 win-x64 / win-arm64）→ SHA256 校验 → 解压到 runtimeDir
 * 3. 顺带清理其它版本的残留目录（版本管理后续再完善）
 */
export async function ensureNode(env: InstallEnv, version: string, onProgress: ProgressCb): Promise<void> {
  const { dirs, log } = env
  const exe = nodeExe(dirs, version)

  if (fs.existsSync(exe)) {
    const v = await runNodeVersion(env, version)
    if (v === version) {
      log.info('node', `Node.js v${version} 已就绪`)
      onProgress('done', 100, `Node.js v${version} 已就绪`)
      return
    }
    log.warn('node', `发现不完整安装（node -v => ${v ?? '?'}），重新安装`)
    await fsp.rm(nodeDistDir(dirs, version), { recursive: true, force: true })
  }

  // 清理与目标版本不同的旧版本目录，保持磁盘整洁
  const targetDirName = path.basename(nodeDistDir(dirs, version))
  const entries = await fsp.readdir(dirs.runtimeDir).catch(() => [] as string[])
  for (const name of entries) {
    if (name.startsWith('node-v') && name !== targetDirName) {
      await fsp.rm(path.join(dirs.runtimeDir, name), { recursive: true, force: true }).catch(() => {})
      log.info('node', `已清理旧版本目录 ${name}`)
    }
  }

  const zipName = `node-v${version}-win-${nodeWinArch()}.zip`
  const zipUrl = `${NODE_DIST}/v${version}/${zipName}`
  const zipPath = path.join(dirs.tmpDir, zipName)

  onProgress('download', 2, `下载 Node.js v${version}（约 30MB）...`)
  log.info('node', `下载 ${zipUrl}`)
  await downloadFile(zipUrl, zipPath, (p) => {
    onProgress('download', 2 + Math.round((p.percent ?? 0) * 0.8), `下载中 ${p.received}/${p.total ?? '?'} 字节`)
  })

  onProgress('verify', 85, '校验 SHA256...')
  const shas = await fetchText(`${NODE_DIST}/v${version}/SHASUMS256.txt`)
  const want = shas
    .split('\n')
    .find((l) => l.includes(zipName))
    ?.split(/\s+/)[0]
  if (!want) throw new Error('无法从 SHASUMS256.txt 中定位校验值')
  const got = await sha256File(zipPath)
  if (want.toLowerCase() !== got.toLowerCase()) {
    throw new Error(`SHA256 校验失败：期望 ${want}，实际 ${got}`)
  }
  log.info('node', 'SHA256 校验通过')

  onProgress('extract', 88, '解压安装...')
  await extract(zipPath, { dir: dirs.runtimeDir })
  await fsp.rm(zipPath, { force: true }).catch(() => {})

  onProgress('verify', 98, '验证安装...')
  const v = await runNodeVersion(env, version)
  if (v !== version) throw new Error(`安装后 node -v 输出异常：${v ?? '(空)'}`)
  log.info('node', `Node.js v${version} 安装完成`)
  onProgress('done', 100, `Node.js v${version} 就绪`)
}

/** 运行 node -v 并返回去掉 v 前缀的版本号；不可用返回 null（15s 超时防挂起） */
export function runNodeVersion(env: InstallEnv, version: string): Promise<string | null> {
  const exe = nodeExe(env.dirs, version)
  if (!fs.existsSync(exe)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const child = spawn(exe, ['-v'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 清空继承自父进程的 NODE_OPTIONS：目标 node 版本可能不认识其中的 flag
      //（如 --use-system-ca 需要 node >= 22.16），否则 node.exe 拒绝启动、node -v 输出为空
      env: { ...process.env, NODE_OPTIONS: '' }
    })
    let out = ''
    let settled = false
    let timer: NodeJS.Timeout
    const done = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    timer = setTimeout(() => {
      child.kill()
      done(null)
    }, 15_000)
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString()
    })
    child.on('error', () => done(null))
    child.on('close', () => done(out.trim().replace(/^v/, '') || null))
  })
}
