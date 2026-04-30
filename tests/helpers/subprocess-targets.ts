// `node -e 'process.stdin.pipe(process.stdout)'` is portable across Linux,
// macOS, and Windows where `cat` is not stock-available.
export const NODE_ECHO_STDIN: readonly string[] = ['-e', 'process.stdin.pipe(process.stdout)']
