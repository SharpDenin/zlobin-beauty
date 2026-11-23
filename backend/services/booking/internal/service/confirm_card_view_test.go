package service

import (
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestClientCardViewRequiredCode(t *testing.T) {
	err := apperr.ConflictCode(apperr.CodeClientCardViewRequired, "просмотрите карточку клиента перед подтверждением записи")
	ae, ok := apperr.As(err)
	if !ok {
		t.Fatal("expected AppError")
	}
	if ae.Code != apperr.CodeClientCardViewRequired {
		t.Fatalf("code=%s", ae.Code)
	}
	if ae.HTTPStatus != 409 {
		t.Fatalf("status=%d", ae.HTTPStatus)
	}
}

func TestAppointmentMasterFlagsShape(t *testing.T) {
	master := uuid.New()
	client := uuid.New()
	a := domain.Appointment{
		ID:           uuid.New(),
		MasterUserID: master,
		ClientUserID: client,
		Status:       domain.StatusPendingConfirmation,
	}
	if a.MasterUserID == a.ClientUserID {
		t.Fatal("fixture ids must differ")
	}
	if a.Status != domain.StatusPendingConfirmation {
		t.Fatal("pending confirmation expected for confirm gate")
	}
}
