pnpm install
pnpm --filter @openkode/core build
pnpm --filter @openkode/cli build
Set-Location packages/cli
pnpm link --global
openkode --version
openkode --help
openkode llmcall "what is 2+2"