// Root layout — intentionally minimal.
// The [locale]/layout.tsx owns the full <html>/<body> shell.
// Having this file prevents Next.js from auto-generating a conflicting wrapper
// that causes the double <html>/<body> hydration error.
export default function RootLayoutShell({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
