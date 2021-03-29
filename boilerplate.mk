MAKEFLAGS += --no-builtin-rules
MAKEFLAGS += --warn-undefined-variables
SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.RECIPEPREFIX = >
.ONESHELL:
.DELETE_ON_ERROR:
.SECONDEXPANSION:
.SILENT:
