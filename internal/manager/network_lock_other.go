//go:build !linux

package manager

import (
	"context"
	"sync"
)

// fnOS uses the Linux process lock. This lock supports native development tests.
var developmentNetworkLocks sync.Map

func (s *Server) lockNetworkMutation(ctx context.Context) (func(), error) {
	value, _ := developmentNetworkLocks.LoadOrStore(s.config.StateDir, make(chan struct{}, 1))
	lock := value.(chan struct{})
	select {
	case lock <- struct{}{}:
		return func() { <-lock }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
