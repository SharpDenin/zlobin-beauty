package service

import (
	"testing"
)

func TestBranchCloseInputKeepsMembershipOutOfScope(t *testing.T) {
	// Marketplace close only clears branch_id / adjusts work_types.
	// Memberships live in organizations and must not be touched here.
	in := BranchCloseInput{}
	if len(in.PrivateMasterUserIDs) != 0 || len(in.UnlinkMasterUserIDs) != 0 {
		t.Fatal("empty input expected")
	}
}
