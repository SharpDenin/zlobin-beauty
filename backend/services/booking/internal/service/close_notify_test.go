package service

import "testing"

func TestBranchCloseNotifyBodyWithPhone(t *testing.T) {
	s := &Service{}
	got := s.branchCloseNotifyBody("+79001112233", "Центр")
	if got != "Филиал «Центр» закрывается, ваша запись отменена. Контактный телефон: +79001112233" {
		t.Fatalf("got %q", got)
	}
}

func TestBranchCloseNotifyBodyWithoutPhone(t *testing.T) {
	s := &Service{}
	got := s.branchCloseNotifyBody("", "Юг")
	if got != "Филиал «Юг» закрывается, ваша запись отменена. Свяжитесь с салоном через приложение" {
		t.Fatalf("got %q", got)
	}
}
