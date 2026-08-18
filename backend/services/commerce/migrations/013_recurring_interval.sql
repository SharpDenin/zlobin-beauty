-- Every-N-weeks frequency plus optional agreement end date.

ALTER TABLE recurring_agreements
    ADD COLUMN IF NOT EXISTS interval_weeks INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS end_date DATE;

ALTER TABLE recurring_agreements DROP CONSTRAINT IF EXISTS recurring_agreements_frequency_check;
ALTER TABLE recurring_agreements
    ADD CONSTRAINT recurring_agreements_frequency_check
    CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'every_n_weeks'));

ALTER TABLE recurring_agreements DROP CONSTRAINT IF EXISTS recurring_agreements_interval_weeks_check;
ALTER TABLE recurring_agreements
    ADD CONSTRAINT recurring_agreements_interval_weeks_check
    CHECK (interval_weeks BETWEEN 1 AND 12);

UPDATE recurring_agreements SET interval_weeks = 2 WHERE frequency = 'biweekly' AND interval_weeks = 1;
