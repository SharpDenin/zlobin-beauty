package httpapi

import (
	"encoding/json"
	"testing"
)

func TestUpsertMasterReqOmitsProfessionTypesWhenMissing(t *testing.T) {
	var req upsertMasterReq
	if err := json.Unmarshal([]byte(`{"display_name":"A","city":"X","organization_id":"11111111-1111-4111-8111-111111111011"}`), &req); err != nil {
		t.Fatal(err)
	}
	if req.ProfessionTypeIDs != nil {
		t.Fatal("omitted profession_type_ids must stay nil so existing types are kept")
	}
}

func TestUpsertMasterReqEmptyProfessionTypesIsExplicit(t *testing.T) {
	var req upsertMasterReq
	if err := json.Unmarshal([]byte(`{"profession_type_ids":[]}`), &req); err != nil {
		t.Fatal(err)
	}
	if req.ProfessionTypeIDs == nil || len(*req.ProfessionTypeIDs) != 0 {
		t.Fatal("empty array must be distinct from omit")
	}
}
