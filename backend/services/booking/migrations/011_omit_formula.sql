-- omit_formula is independent from skip_service_scheme (skipped).
-- It records the master's choice not to disclose the color formula to other professionals.

ALTER TABLE appointment_service_schemes
    ADD COLUMN IF NOT EXISTS omit_formula BOOLEAN NOT NULL DEFAULT FALSE;
