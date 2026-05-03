// `node -e 'process.stdin.pipe(process.stdout)'` is portable across Linux,
// macOS, and Windows where `cat` is not stock-available.
export const NODE_ECHO_STDIN: readonly string[] = ['-e', 'process.stdin.pipe(process.stdout)']

// Long-running subprocess (5s sleep). Tests pair this with `timeout` or
// `cancelSignal` to exercise the abort/timeout paths without flaky timing.
export const SLEEP_5S: readonly string[] = ['-e', 'setTimeout(() => {}, 5000)']
