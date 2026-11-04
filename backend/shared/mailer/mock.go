package mailer

import (
	"context"
	"sync"
)

// Mock records Send calls for automated tests.
type Mock struct {
	mu      sync.Mutex
	ready   bool
	Sent    []Message
	FailErr error
}

func NewMock(ready bool) *Mock {
	return &Mock{ready: ready}
}

func (m *Mock) Ready() bool { return m.ready }

func (m *Mock) Send(_ context.Context, msg Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.FailErr != nil {
		return m.FailErr
	}
	if !m.ready {
		return ErrNotConfigured
	}
	m.Sent = append(m.Sent, msg)
	return nil
}

func (m *Mock) Last() (Message, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.Sent) == 0 {
		return Message{}, false
	}
	return m.Sent[len(m.Sent)-1], true
}

func (m *Mock) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Sent = nil
}
