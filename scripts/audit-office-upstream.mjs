#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditOfficeUpstream, parseOfficeUpstreamAuditArguments } from './office/upstream-audit.mjs'

export { auditOfficeUpstream, parseOfficeUpstreamAuditArguments }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    process.stdout.write('Usage: node scripts/audit-office-upstream.mjs [--project <absolute-dir>] [--official <absolute-repository>] [--vendor <absolute-worktree>] [--lock <absolute-file>] [--old <40-char-sha-or-tag>] [--target <40-char-sha-or-tag>] [--target-sha <expected-commit-sha>]\nReads local Git objects only. Never fetches, merges, checks out branches or updates a lock. Old baseline is mandatory when lock.vendorBaseSha is null.\n')
  } else {
    let result
    try { result = auditOfficeUpstream(parseOfficeUpstreamAuditArguments(process.argv.slice(2))) } catch (error) {
      result = { ok: false, code: error.code || 'OFFICE_AUDIT_FAILED', detail: error.detail || {}, reviewState: 'blocked-no-audit-conclusion' }
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    process.exitCode = result.ok ? 0 : 1
  }
}
