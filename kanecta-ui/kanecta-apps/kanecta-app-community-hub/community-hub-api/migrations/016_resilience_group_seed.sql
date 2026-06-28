INSERT INTO groups (id, name, description, public_description)
VALUES (
  '94a7ad3b-89bb-49c6-a97d-228f8758517a',
  'Resilience Group',
  'Featherston community resilience working group',
  'A community group focused on local resilience, preparedness, and sustainability in Featherston.'
)
ON CONFLICT (id) DO NOTHING;
