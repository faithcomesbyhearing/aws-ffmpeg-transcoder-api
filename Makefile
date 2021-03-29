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
