//go:build linux

package manager

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

func (s *Server) lockNetworkMutation(ctx context.Context) (func(), error) {
	if err := os.MkdirAll(s.config.StateDir, 0700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(s.config.StateDir, "network.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	for {
		err = syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return func() { syscall.Flock(int(file.Fd()), syscall.LOCK_UN); file.Close() }, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EAGAIN) {
			file.Close()
			return nil, err
		}
		select {
		case <-ctx.Done():
			file.Close()
			return nil, errors.New("另一项网络操作仍在进行，请稍后重试")
		case <-time.After(50 * time.Millisecond):
		}
	}
}
