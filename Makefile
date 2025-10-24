include boilerplate.mk

.PHONY: all
all: terraform

submodules := $(patsubst %/Makefile,%,$(wildcard */Makefile))

.PHONY: $(submodules)
$(submodules):
> $(MAKE) -C $@

.PHONY: terraform
terraform: lambdas ffmpeg-layer ffprobe-layer
> terraform apply -auto-approve terraform

.PHONY: terraform-init
terraform-init:
> terraform init terraform

.PHONY: local-start
local-start: lambdas ffmpeg-layer ffprobe-layer
> $(MAKE) -C lambdas start

.PHONY: local-stop
local-stop:
> $(MAKE) -C lambdas stop

local-execute-%:
> $(MAKE) -C lambdas $*-execute

.PHONY: clean
clean:
> $(MAKE) -C lambdas clean
> $(MAKE) -C ffmpeg-layer clean
> $(MAKE) -C ffprobe-layer clean
