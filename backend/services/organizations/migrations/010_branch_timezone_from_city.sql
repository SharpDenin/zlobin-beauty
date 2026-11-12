-- Align branch IANA zones with known service cities when the row still carries
-- the historical Europe/Moscow default. Does NOT rewrite appointments:
-- appointment.location_timezone stays frozen as stored at booking time.
-- See docs notes in the timezone audit: historical UTC instants are left untouched.

UPDATE branches
SET timezone = 'Asia/Krasnoyarsk',
    updated_at = now()
WHERE timezone = 'Europe/Moscow'
  AND lower(trim(city)) = 'красноярск';

UPDATE branches
SET timezone = 'Asia/Novosibirsk',
    updated_at = now()
WHERE timezone = 'Europe/Moscow'
  AND lower(trim(city)) = 'новосибирск';
