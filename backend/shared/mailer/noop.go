package mailer

import "context"

// Noop is used when SMTP credentials are missing. Ready() is false; Send returns ErrNotConfigured.
type Noop struct{}

func (Noop) Ready() bool { return false }

func (Noop) Send(context.Context, Message) error { return ErrNotConfigured }
