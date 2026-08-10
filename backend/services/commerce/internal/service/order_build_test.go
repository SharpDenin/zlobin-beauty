package service

import (
	"testing"

	"github.com/google/uuid"
	"github.com/zlobin/zlobin-beauty/backend/services/commerce/internal/domain"
	"github.com/zlobin/zlobin-beauty/backend/shared/apperr"
)

func TestBuildOrderItemsTotalsAndSnapshots(t *testing.T) {
	supplier := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	p1 := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	products := map[uuid.UUID]*domain.Product{
		p1: {
			ID: p1, OrganizationID: supplier, Name: "Shampoo", SKU: "SH-1",
			PriceMinor: 1000, Published: true, ForSale: true,
		},
	}
	built, err := buildOrderItems(supplier, []OrderItemInput{
		{ProductID: p1, QtyOrdered: 2},
		{ProductID: p1, QtyOrdered: 1.5},
	}, func(id uuid.UUID) (*domain.Product, error) {
		return products[id], nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if built.SubtotalMinor != 3500 {
		t.Fatalf("subtotal want 3500 got %d", built.SubtotalMinor)
	}
	if got := domain.OrderTotalMinor(built.SubtotalMinor, 250); got != 3750 {
		t.Fatalf("total want 3750 got %d", got)
	}
	if built.Items[0].ProductName != "Shampoo" || built.Items[0].ProductSKU != "SH-1" {
		t.Fatalf("snapshot missing: %+v", built.Items[0])
	}
}

func TestBuildOrderItemsRejectsUnpublishedOrNotForSale(t *testing.T) {
	supplier := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	pid := uuid.MustParse("cccccccc-cccc-cccc-cccc-cccccccccccc")
	cases := []struct {
		name string
		p    domain.Product
	}{
		{"unpublished", domain.Product{ID: pid, OrganizationID: supplier, Published: false, ForSale: true, PriceMinor: 1}},
		{"not_for_sale", domain.Product{ID: pid, OrganizationID: supplier, Published: true, ForSale: false, PriceMinor: 1}},
		{"wrong_supplier", domain.Product{ID: pid, OrganizationID: uuid.MustParse("dddddddd-dddd-dddd-dddd-dddddddddddd"), Published: true, ForSale: true, PriceMinor: 1}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := tc.p
			_, err := buildOrderItems(supplier, []OrderItemInput{{ProductID: pid, QtyOrdered: 1}}, func(uuid.UUID) (*domain.Product, error) {
				return &p, nil
			})
			if err == nil {
				t.Fatal("expected validation error")
			}
			if _, ok := apperr.As(err); !ok {
				t.Fatalf("expected apperr, got %v", err)
			}
		})
	}
}

func TestBuildOrderItemsRejectsNonPositiveQty(t *testing.T) {
	supplier := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	pid := uuid.MustParse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
	_, err := buildOrderItems(supplier, []OrderItemInput{{ProductID: pid, QtyOrdered: 0}}, func(uuid.UUID) (*domain.Product, error) {
		return &domain.Product{ID: pid, OrganizationID: supplier, Published: true, ForSale: true}, nil
	})
	if err == nil {
		t.Fatal("expected error")
	}
}
