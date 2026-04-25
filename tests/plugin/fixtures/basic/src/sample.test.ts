import { test } from 'vitest'
import { execa } from '../../../../../src/execa.js'

test('records node version', async () => {
  await execa('node', ['--version'])
})
