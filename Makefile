SHELL := /usr/bin/env bash

.PHONY: test validate tools build build-x86 build-arm clean detect-upstream update-upstream

test:
	go test ./...

validate:
	./scripts/validate.sh

tools:
	./scripts/install-fnpack.sh

build: validate tools
	./scripts/build-all.sh

build-x86: validate tools
	./scripts/build-fpk.sh x86

build-arm: validate tools
	./scripts/build-fpk.sh arm

detect-upstream:
	./scripts/detect-upstream.sh

update-upstream:
	./scripts/update-upstream-lock.sh

clean:
	./scripts/clean.sh
