include ../boilerplate.mk

lambdas := $(patsubst %/package.json,%,$(wildcard */package.json))

.PHONY: lambdas
lambdas: $(addsuffix /index.js,$(lambdas))

$(addsuffix /index.js,$(lambdas)): %/index.js: $$*/node_modules/.make $$*/tsconfig.json $$*/*.ts
> echo Transpiling TypeScript for $* Lambda
> cd $*
> npx tsc

$(addsuffix /node_modules/.make,$(lambdas)): %/node_modules/.make: $$*/package.json
> echo Installing NPM modules for $* Lambda
> cd $*
> npm install
> touch ../$@

.PHONY: clean
clean: $(addsuffix .clean,$(lambdas))

.PHONY: $(addsuffix .clean,$(lambdas))
$(addsuffix .clean,$(lambdas)): %.clean:
> @echo Cleaning $*
> rm -rf $*/{node_modules,*.js}
