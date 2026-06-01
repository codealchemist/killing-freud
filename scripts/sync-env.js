#!/usr/bin/env node
// Reads all vars from .env and pushes them to the linked Netlify site.
const { spawnSync } = require('child_process')
const fs = require('fs')

const raw = fs.readFileSync('.env', 'utf8')

for (const line of raw.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue

  const eq = trimmed.indexOf('=')
  if (eq === -1) continue

  const key = trimmed.slice(0, eq).trim()
  const value = trimmed.slice(eq + 1).trim()
  if (!value) continue

  console.log(`Setting ${key}...`)
  const result = spawnSync('netlify', ['env:set', key, value], {
    stdio: 'inherit'
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log('Done.')
