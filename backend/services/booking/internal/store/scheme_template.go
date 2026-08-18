package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/zlobin/zlobin-beauty/backend/services/booking/internal/domain"
)

func (s *Store) GetActiveSchemeTemplate(ctx context.Context, categoryKey string) (*domain.SchemeTemplate, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, category_key, version, name, fields, active
FROM scheme_templates
WHERE category_key=$1 AND active=TRUE
ORDER BY version DESC
LIMIT 1`, categoryKey)
	var t domain.SchemeTemplate
	var id uuid.UUID
	var fields []byte
	if err := row.Scan(&id, &t.CategoryKey, &t.Version, &t.Name, &fields, &t.Active); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	t.ID = id.String()
	if len(fields) > 0 {
		_ = json.Unmarshal(fields, &t.Fields)
	}
	return &t, nil
}
