package domain

import "testing"

func TestDispositionRemaining(t *testing.T) {
	if got := DispositionRemaining(100, 80, 10, 10); got != 0 {
		t.Fatalf("full disposition remaining=%v", got)
	}
	if got := DispositionRemaining(10, 6, 0, 0); got < 3.9 || got > 4.1 {
		t.Fatalf("partial remaining=%v want 4", got)
	}
	if got := DispositionRemaining(5, 5, 0, 0); got != 0 {
		t.Fatalf("already accepted remaining=%v", got)
	}
	if got := DispositionRemaining(1, 2, 0, 0); got != 0 {
		t.Fatalf("over-accepted remaining=%v", got)
	}
}
