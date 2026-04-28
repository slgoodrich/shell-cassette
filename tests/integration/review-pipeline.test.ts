import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Decision } from '../../src/cli-review.js'
import { applyDecisions, preScan } from '../../src/cli-review.js'
import { deserialize, serialize } from '../../src/serialize.js'
import type { CassetteFile, RedactConfig } from '../../src/types.js'
import { makeRecording } from '../helpers/recording.js'

const config: RedactConfig = {
  bundledPatterns: true,
  customPatterns: [],
  suppressPatterns: [],
  envKeys: [],
  warnLengthThreshold: 40,
  warnPathHeuristic: true,
}

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-review-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const PAT = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
const baseCassette = (stdoutLines: string[]): CassetteFile => ({
  version: 2,
  recordedBy: null,
  recordings: [makeRecording({ result: { stdoutLines } })],
})

describe('applyDecisions', () => {
  test('accept decision: replaces match with counter-tagged placeholder', () => {
    const cassette = baseCassette([`Token: ${PAT}`])
    const findings = preScan(cassette, config)
    expect(findings).toHaveLength(1)
    const f0 = findings[0]
    if (f0 === undefined) throw new Error('expected finding')
    const decisions = new Map<string, Decision>([[f0.id, { kind: 'accept' }]])
    const updated = applyDecisions(cassette, findings, decisions, config)
    expect(updated.recordings[0]?.result.stdoutLines[0]).toBe(
      'Token: <redacted:stdout:github-pat-classic:1>',
    )
    expect(updated.recordings[0]?.redactions).toContainEqual({
      rule: 'github-pat-classic',
      source: 'stdout',
      count: 1,
    })
  })

  test('skip decision: leaves match in body, persists SuppressedEntry', () => {
    const cassette = baseCassette([`Token: ${PAT}`])
    const findings = preScan(cassette, config)
    const f0 = findings[0]
    if (f0 === undefined) throw new Error('expected finding')
    const decisions = new Map<string, Decision>([[f0.id, { kind: 'skip' }]])
    const updated = applyDecisions(cassette, findings, decisions, config)
    expect(updated.recordings[0]?.result.stdoutLines[0]).toBe(`Token: ${PAT}`)
    expect(updated.recordings[0]?.suppressed).toHaveLength(1)
    expect(updated.recordings[0]?.suppressed[0]).toMatchObject({
      source: 'stdout',
      rule: 'github-pat-classic',
      matchHash: f0.matchHash,
    })
  })

  test('replace decision: substitutes user-provided string in body', () => {
    const cassette = baseCassette([`Token: ${PAT}`])
    const findings = preScan(cassette, config)
    const f0 = findings[0]
    if (f0 === undefined) throw new Error('expected finding')
    const decisions = new Map<string, Decision>([[f0.id, { kind: 'replace', with: 'FAKE-TOKEN' }]])
    const updated = applyDecisions(cassette, findings, decisions, config)
    expect(updated.recordings[0]?.result.stdoutLines[0]).toBe('Token: FAKE-TOKEN')
    expect(updated.recordings[0]?.redactions).toContainEqual({
      rule: 'custom',
      source: 'stdout',
      count: 1,
    })
  })

  test('delete decision: removes the recording entirely', () => {
    const cassette: CassetteFile = {
      version: 2,
      recordedBy: null,
      recordings: [
        makeRecording({ result: { stdoutLines: [`Token: ${PAT}`] } }),
        makeRecording({ result: { stdoutLines: ['ok'] } }),
      ],
    }
    const findings = preScan(cassette, config)
    const f0 = findings[0]
    if (f0 === undefined) throw new Error('expected finding')
    const decisions = new Map<string, Decision>([[f0.id, { kind: 'delete', recordingIndex: 0 }]])
    const updated = applyDecisions(cassette, findings, decisions, config)
    expect(updated.recordings).toHaveLength(1)
    expect(updated.recordings[0]?.result.stdoutLines[0]).toBe('ok')
  })

  test('mixed decisions: accept one finding, skip another in same recording', () => {
    const PAT2 = 'ghp_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
    const cassette = baseCassette([`A: ${PAT}`, `B: ${PAT2}`])
    const findings = preScan(cassette, config)
    expect(findings).toHaveLength(2)
    const f0 = findings[0]
    const f1 = findings[1]
    if (f0 === undefined || f1 === undefined) throw new Error('expected findings')
    const decisions = new Map<string, Decision>([
      [f0.id, { kind: 'accept' }],
      [f1.id, { kind: 'skip' }],
    ])
    const updated = applyDecisions(cassette, findings, decisions, config)
    expect(updated.recordings[0]?.result.stdoutLines[0]).toContain(
      '<redacted:stdout:github-pat-classic',
    )
    expect(updated.recordings[0]?.result.stdoutLines[1]).toBe(`B: ${PAT2}`)
    expect(updated.recordings[0]?.suppressed).toHaveLength(1)
  })

  test('result round-trips through serialize/deserialize as valid v2', async () => {
    const cassette = baseCassette([`Token: ${PAT}`])
    const findings = preScan(cassette, config)
    const f0 = findings[0]
    if (f0 === undefined) throw new Error('expected finding')
    const decisions = new Map<string, Decision>([[f0.id, { kind: 'skip' }]])
    const updated = applyDecisions(cassette, findings, decisions, config)
    const fixturePath = path.join(tmp, 'out.json')
    await writeFile(fixturePath, serialize(updated))
    const reloaded = deserialize(await readFile(fixturePath, 'utf8'))
    expect(reloaded.version).toBe(2)
    expect(reloaded.recordings[0]?.suppressed).toHaveLength(1)
  })
})
