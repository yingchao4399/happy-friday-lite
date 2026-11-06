import fs from 'node:fs'

function replaceOnce(source, needle, value, id) {
  if (!source.includes(needle)) throw new Error(`OFFICE_HTML_DOCX_ADAPTER_DRIFT: ${id}`)
  return source.replace(needle, value)
}

/**
 * Keep the pinned GenOffice checkout pristine while applying the one host
 * runtime fix needed by Friday's hidden Electron export window. Chromium's
 * Page.captureScreenshot may never resolve for a hidden window when a clipped
 * capture requests content beyond the viewport; Electron's native capturePage
 * does not have that failure mode.
 */
export function transformHtmlDocxDriverSource(source, id) {
  const file = id.replaceAll('\\', '/')
  source = replaceOnce(
    source,
    'const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))',
    `const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const CAPTURE_FALLBACK_TIMEOUT_MS = 5000
const DEBUG = process.env.FRIDAY_HTML_DOCX_DEBUG === '1'
const debug = (...args: unknown[]) => { if (DEBUG) console.warn(...args) }`,
    file,
  )
  const cdpCapture = `const { data } = (await this.cdp.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        ...(options.clip ? { clip: { ...options.clip, scale: 1 } } : {}),
      })) as { data: string }
      return Buffer.from(data, 'base64')`
  source = replaceOnce(
    source,
    cdpCapture,
    `try {
      const image = await this.wc.capturePage(options.clip)
      const png = image.toPNG()
      debug('[html2docx:electron] native screenshot complete', png.length)
      return png
    } catch (nativeError) {
      debug('[html2docx:electron] native screenshot failed; using CDP fallback', nativeError)
      const cdp = this.cdp.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        ...(options.clip ? { clip: { ...options.clip, scale: 1 } } : {}),
      }) as Promise<{ data: string }>
      const result = await Promise.race([
        cdp,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('CDP screenshot timed out')), CAPTURE_FALLBACK_TIMEOUT_MS),
        ),
      ])
      debug('[html2docx:electron] CDP screenshot complete', result.data.length)
      return Buffer.from(result.data, 'base64')
    }`,
    file,
  )
  return source
}

export function htmlDocxAdapterPlugin() {
  return {
    name: 'friday-html-docx-adapter',
    setup(build) {
      build.onLoad({ filter: /[\\/]packages[\\/]html2docx[\\/]src[\\/]drivers[\\/]electron\.ts$/ }, args => {
        const source = fs.readFileSync(args.path, 'utf8')
        return { contents: transformHtmlDocxDriverSource(source, args.path), loader: 'ts' }
      })
    },
  }
}
