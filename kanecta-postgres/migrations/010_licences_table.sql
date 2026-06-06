-- Kanecta postgres schema — spec version 1.2.0
-- Replaces the generic items.license -> items(id) reference (008/009) with a
-- dedicated `licences` lookup table and a hard FK to it, seeded with the
-- common public-domain, Creative Commons and software licences, plus a
-- default "All Rights Reserved" (copyright) entry — copyright being the
-- real-world default when no licence is explicitly granted.
--
-- ACKNOWLEDGED SHORTCUT: the long-term direction is for Licence to be an
-- ordinary standalone Kanecta custom-type item, like any other reusable
-- concept (referenced by typeId, with its own author-defined sqlSchema). A
-- fixed table is chosen for now because this is a small, well-known,
-- enumerable reference set that benefits from referential integrity and a
-- column DEFAULT today. Migrating these rows into real items later — keeping
-- their UUIDs — is a plain data move; nothing that stores or reads
-- `items.license` needs to change.
--
-- Licence full text is intentionally NOT inlined here (would bloat the
-- migration substantially for ~19 licences); `url` points at the canonical
-- text and `text` is left for an application to backfill/cache if desired.

ALTER TABLE items DROP CONSTRAINT IF EXISTS fk_items_license;

CREATE TABLE licences (
    id      UUID PRIMARY KEY,
    name    TEXT NOT NULL,
    spdx_id TEXT UNIQUE,
    url     TEXT,
    text    TEXT
);

INSERT INTO licences (id, name, spdx_id, url) VALUES
    ('bb3bf137-d8a9-4264-9fb7-ac373b1d4739', 'All Rights Reserved (Copyright)',                                            NULL,              NULL),
    ('055f0bd5-7080-4d04-8137-b6b15421ced7', 'Public Domain',                                                              NULL,              NULL),
    ('8fd63076-6ee1-4c81-90a2-f7a2371728bd', 'CC0 1.0 Universal (Public Domain Dedication)',                               'CC0-1.0',         'https://creativecommons.org/publicdomain/zero/1.0/'),
    ('6bdb1772-6dc7-4b78-8111-63ccc27f36ac', 'Creative Commons Attribution 4.0 International',                             'CC-BY-4.0',       'https://creativecommons.org/licenses/by/4.0/'),
    ('f3753e87-6b36-4939-8e31-70d504f1a36c', 'Creative Commons Attribution-ShareAlike 4.0 International',                  'CC-BY-SA-4.0',    'https://creativecommons.org/licenses/by-sa/4.0/'),
    ('d2376760-70f6-4ded-9471-6a0b2b69f43f', 'Creative Commons Attribution-NoDerivatives 4.0 International',               'CC-BY-ND-4.0',    'https://creativecommons.org/licenses/by-nd/4.0/'),
    ('698687e6-d96f-4b95-95e1-eb91ff09b8d5', 'Creative Commons Attribution-NonCommercial 4.0 International',               'CC-BY-NC-4.0',    'https://creativecommons.org/licenses/by-nc/4.0/'),
    ('9ba88bde-7926-47f2-ab18-df9a5fa95bd4', 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International',    'CC-BY-NC-SA-4.0', 'https://creativecommons.org/licenses/by-nc-sa/4.0/'),
    ('535a6b2e-4f84-40d4-ac4b-656ad18256b4', 'Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International', 'CC-BY-NC-ND-4.0', 'https://creativecommons.org/licenses/by-nc-nd/4.0/'),
    ('058b1c83-6a7f-4b71-ac99-c3a73baad664', 'MIT License',                                                                'MIT',             'https://opensource.org/license/mit/'),
    ('e58246ce-4c9b-4b60-90b4-b442cccecba5', 'Apache License 2.0',                                                         'Apache-2.0',      'https://www.apache.org/licenses/LICENSE-2.0'),
    ('6af82527-a086-4596-a07f-84ca3cad2277', 'GNU General Public License v3.0',                                            'GPL-3.0-only',    'https://www.gnu.org/licenses/gpl-3.0.html'),
    ('c55442ee-47c4-4d1f-b7f3-5e994c57d6e9', 'GNU General Public License v2.0',                                            'GPL-2.0-only',    'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html'),
    ('aa0e9c4a-5c1a-4213-b7f1-a32be5929216', 'GNU Lesser General Public License v3.0',                                     'LGPL-3.0-only',   'https://www.gnu.org/licenses/lgpl-3.0.html'),
    ('56df650f-f2e9-415f-a7bb-6f87805aa15b', 'BSD 3-Clause License',                                                       'BSD-3-Clause',    'https://opensource.org/license/bsd-3-clause/'),
    ('09eda7ea-4130-4e04-91a3-38970024da3c', 'BSD 2-Clause License',                                                       'BSD-2-Clause',    'https://opensource.org/license/bsd-2-clause/'),
    ('9d233a14-4a41-4be4-8f1c-7df236bf5fa7', 'Mozilla Public License 2.0',                                                 'MPL-2.0',         'https://www.mozilla.org/en-US/MPL/2.0/'),
    ('74baaf34-23ab-45f7-ae14-fce862a37d41', 'ISC License',                                                                'ISC',             'https://opensource.org/license/isc-license-txt/'),
    ('d4f4b3b2-a652-4dd2-b83e-18aabf50b053', 'The Unlicense',                                                              'Unlicense',       'https://unlicense.org/')
ON CONFLICT (id) DO NOTHING;

-- Existing items with no licence default to "All Rights Reserved" — the
-- real-world default when nothing else has been declared.
UPDATE items SET license = 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739' WHERE license IS NULL;

ALTER TABLE items
    ALTER COLUMN license SET DEFAULT 'bb3bf137-d8a9-4264-9fb7-ac373b1d4739',
    ALTER COLUMN license SET NOT NULL;

ALTER TABLE items
    ADD CONSTRAINT fk_items_license FOREIGN KEY (license) REFERENCES licences(id);

INSERT INTO schema_version (id, version)
VALUES (TRUE, '1.6.0')
ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = NOW();
