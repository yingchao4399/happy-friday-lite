#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateOfficeUpstreamLock } from './office/upstream-lock.mjs'

export { validateOfficeUpstreamLock } from './office/upstream-lock.mjs'

export function parseOfficeUpstreamArguments(args) {
  const options = {}
  for (const argument of args) {
    if (argument === '--require-approved-upstream' && !options.requireApproved) options.requireApproved = true
    else if (argument === '--verify-remote' && !options.verifyRemote) options.verifyRemote = true
    else throw Object.assign(new Error('OFFICE_UPSTREAM_ARGUMENT_INVALID'), { code: 'OFFICE_UPSTREAM_ARGUMENT_INVALID' })
  }
  if (options.requireApproved) options.verifyRemote = true
  return options
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result
  try { result = validateOfficeUpstreamLock(parseOfficeUpstreamArguments(process.argv.slice(2))) } catch (error) {
    const code = error?.code || 'OFFICE_UPSTREAM_VERIFY_FAILED'
    result = { ok: false, code, issues: [{ code }] }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  process.exitCode = result.ok ? 0 : 1
}
