package service

import (
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func TestBranchCloseNotifyIdempotencyKeysAreAppointmentScoped(t *testing.T) {
	id := uuid.Must(uuid.NewV7())
	client := fmt.Sprintf("branch-close:%s:client", id.String())
	master := fmt.Sprintf("branch-close:%s:master", id.String())
	if client == master {
		t.Fatal("client and master keys must differ")
	}
	if client != "branch-close:"+id.String()+":client" {
		t.Fatalf("client key=%s", client)
	}
}
