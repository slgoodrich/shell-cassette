import { ConcurrencyError } from './errors.js'
import { cassettePath } from './paths.js'

type VitestSuiteLike = {
  name: string
  suite?: VitestSuiteLike
}

type VitestTaskLike = {
  name: string
  file?: { filepath: string }
  suite?: VitestSuiteLike
  concurrent?: boolean
}

export function deriveCassettePathFromTask(task: VitestTaskLike, cassetteDir: string): string {
  if (task.concurrent === true) {
    throw new ConcurrencyError(
      `shell-cassette: vitest plugin cannot safely auto-cassette test.concurrent (module global races under concurrent execution).
Options:
  1. Don't use test.concurrent in this file
  2. Move concurrent tests to a separate test file that doesn't import 'shell-cassette/vitest', and use useCassette(cassettePath, fn) explicitly in each test body.`,
    )
  }

  const filepath = task.file?.filepath
  if (!filepath) {
    throw new Error('shell-cassette: vitest task missing file.filepath')
  }

  const describePath: string[] = []
  let suite = task.suite
  while (suite) {
    if (suite.name) describePath.unshift(suite.name)
    suite = suite.suite
  }

  return cassettePath(filepath, describePath, task.name, cassetteDir)
}
