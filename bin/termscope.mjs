#!/usr/bin/env node
try {
  await import('../build/cli.mjs')
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.url?.endsWith('/build/cli.mjs')) throw error
  process.stderr.write('Run npm run build:cli before using the termscope executable.\n')
  process.exitCode = 1
}
