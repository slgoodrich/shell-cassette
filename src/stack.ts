export function cleanStack(stack: string | undefined): string {
  if (!stack) return ''
  const lines = stack.split('\n')
  const filtered = lines.filter((line) => !line.includes('/shell-cassette/'))
  return filtered.join('\n')
}

export function cleanErrorStack(error: Error): void {
  if (error.stack) {
    error.stack = cleanStack(error.stack)
  }
}
