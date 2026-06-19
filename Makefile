# Common Prism tasks. Run `make <target>`.
.PHONY: install build typecheck test lint verify bundle index seller relayer deploy clean help

help: ; @echo "targets: install build test lint verify bundle index seller relayer deploy clean"
install: ; npm install
build: ; npm run build
typecheck: ; npm run typecheck
test: ; npm test
lint: ; npm run lint
verify: ; npm run verify:naming
bundle: ; npm run build:bundle
index: ; node apps/index/dist/server.js
seller: ; npm run start --workspace @prism/example-paid-api
relayer: ; npm run start --workspace @prism/relayer
deploy: ; npx vercel deploy --prod
clean: ; npm run clean
