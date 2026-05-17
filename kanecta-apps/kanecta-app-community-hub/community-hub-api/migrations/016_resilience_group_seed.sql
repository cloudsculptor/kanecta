INSERT INTO groups (id, name, description, public_description)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Resilience Group',
  'Featherston community resilience working group',
  'A community group focused on local resilience, preparedness, and sustainability in Featherston.'
)
ON CONFLICT (id) DO NOTHING;
