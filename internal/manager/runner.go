package manager

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// CommandResult keeps stdout separate from stderr because several Tailscale
// JSON commands print compatibility warnings to stderr.
type CommandResult struct {
	Stdout []byte
	Stderr []byte
}

type Runner interface {
	Run(ctx context.Context, args ...string) (CommandResult, error)
}

type CLIRunner struct {
	Binary string
	Socket string
}

func (r CLIRunner) Run(ctx context.Context, args ...string) (CommandResult, error) {
	commandArgs := make([]string, 0, len(args)+1)
	commandArgs = append(commandArgs, "--socket="+r.Socket)
	commandArgs = append(commandArgs, args...)

	command := exec.CommandContext(ctx, r.Binary, commandArgs...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	return CommandResult{Stdout: stdout.Bytes(), Stderr: stderr.Bytes()}, err
}

func commandMessage(result CommandResult, err error) string {
	message := strings.TrimSpace(string(result.Stderr))
	if message == "" {
		message = strings.TrimSpace(string(result.Stdout))
	}
	if message == "" && err != nil {
		message = err.Error()
	}
	message = strings.Join(strings.Fields(message), " ")
	if len(message) > 600 {
		message = message[:600] + "…"
	}
	if message == "" {
		message = "Tailscale 命令执行失败"
	}
	return message
}

func combinedOutput(result CommandResult) string {
	return fmt.Sprintf("%s\n%s", result.Stdout, result.Stderr)
}
