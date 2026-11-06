#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncOfficeHtmlUpstream, validateOfficeHtmlUpstream } from './office/html-upstream.mjs'

export function parseOfficeHtmlUpstreamArguments(args) {
  const options = {}
  let verify = false
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--verify' && !verify) verify = true
    else if (argument === '--seed' && options.seedRepository === undefined) {
      const value = args[++index]
      if (!value || value.startsWith('--') || !path.isAbsolute(value)) throw Object.assign(new Error('OFFICE_HTML_SEED_ABSOLUTE_REQUIRED'), { code: 'OFFICE_HTML_SEED_ABSOLUTE_REQUIRED' })
      options.seedRepository = value
    } else throw Object.assign(new Error('OFFICE_HTML_SYNC_ARGUMENT_INVALID'), { code: 'OFFICE_HTML_SYNC_ARGUMENT_INVALID' })
  }
  if (verify && options.seedRepository) throw Object.assign(new Error('OFFICE_HTML_SYNC_ARGUMENT_INVALID'), { code: 'OFFICE_HTML_SYNC_ARGUMENT_INVALID' })
  return { verify, options }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result
  try {
    const { verify, options } = parseOfficeHtmlUpstreamArguments(process.argv.slice(2))
    result = verify ? validateOfficeHtmlUpstream(options) : syncOfficeHtmlUpstream(options)
  } catch (error) {
    const code = error.code || 'OFFICE_HTML_SYNC_FAILED'
    result = { ok: false, code, issues: [{ code }] }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  process.exitCode = result.ok ? 0 : 1
}
