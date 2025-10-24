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

.PHONY: start
start: $(addsuffix .start,$(lambdas))

%.start: %/index.js ../ffmpeg-layer/layer/bin/ffmpeg ../ffprobe-layer/layer/bin/ffprobe %/event.json
> echo Building Docker image for $* Lambda
> docker build -t $*-lambda -f Dockerfile $*
> echo Running $* Lambda in Docker
> PORT=90$$((RANDOM%100)); \
  docker run -d --rm --name $*-lambda -p $$PORT:8080 \
  -v $(PWD)/../ffmpeg-layer/layer/bin:/opt/bin/ffmpeg:ro \
  -v $(PWD)/../ffprobe-layer/layer/bin:/opt/bin/ffprobe:ro \
  --env-file $*/.env \
  -e NODE_ENV=local \
  $*-lambda
> echo Started $* Lambda on port $$PORT

.PHONY: stop
stop: $(addsuffix .stop,$(lambdas))

%.stop:
> echo Stopping $* Lambda in Docker
> docker stop $*-lambda || true

%-execute:
> echo Executing $*-lambda
> PORT=$$(docker inspect -f '{{ (index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort }}' $*-lambda)
> curl -X POST -v "http://localhost:$$PORT/2015-03-31/functions/function/invocations" -d @$*/event.json
> echo

.PHONY: clean
clean: $(addsuffix .clean,$(lambdas))

.PHONY: $(addsuffix .clean,$(lambdas))
$(addsuffix .clean,$(lambdas)): %.clean:
> @echo Cleaning $*
> rm -rf $*/{node_modules,*.js}
