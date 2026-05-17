CREATE TABLE IF NOT EXISTS licences (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT    NOT NULL,
  url               TEXT,
  public_description TEXT,
  private_details   TEXT,
  badge             TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0
);

INSERT INTO licences (id, name, url, public_description, private_details, badge, sort_order)
VALUES
  (
    gen_random_uuid(),
    'Public Domain (Unlicense)',
    'https://unlicense.org/',
    'No rights reserved. Anyone can use, copy, modify, and distribute this work freely, even for commercial purposes, with no conditions.',
    'Maximum freedom for reuse. Ideal for community content you want anyone to build upon without any restrictions.',
    'Encouraged',
    1
  ),
  (
    gen_random_uuid(),
    'CC0 1.0 Universal',
    'https://creativecommons.org/publicdomain/zero/1.0/',
    'Creative Commons public domain dedication. The author waives all copyright and related rights worldwide, to the extent permitted by law.',
    'Functionally identical to Public Domain but more explicit about the waiver process and international applicability.',
    NULL,
    2
  ),
  (
    gen_random_uuid(),
    'CC BY 4.0',
    'https://creativecommons.org/licenses/by/4.0/',
    'Attribution required. Others may share, adapt, and use this work commercially, as long as they credit the original author.',
    'Good default for open content. Permits maximum reuse while ensuring the community gets credit for its work.',
    'Next best',
    3
  ),
  (
    gen_random_uuid(),
    'CC BY-SA 4.0',
    'https://creativecommons.org/licenses/by-sa/4.0/',
    'Attribution and share-alike required. Others may adapt and use this work commercially, but must use the same licence for derivative works.',
    'Ensures the content and any improvements remain open. Used by Wikipedia. Good when you want a "viral open" effect.',
    'Next best',
    4
  ),
  (
    gen_random_uuid(),
    'CC BY-NC 4.0',
    'https://creativecommons.org/licenses/by-nc/4.0/',
    'Attribution required, non-commercial use only. Others may share and adapt this work but not for commercial purposes.',
    'Use when you want to allow community sharing but prevent commercial exploitation of the content.',
    NULL,
    5
  ),
  (
    gen_random_uuid(),
    'CC BY-NC-SA 4.0',
    'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    'Attribution required, non-commercial, and share-alike. Others may adapt and share but not commercially, and must use the same licence.',
    'Combines non-commercial restriction with viral openness. Content improvements stay open but out of commercial reach.',
    NULL,
    6
  ),
  (
    gen_random_uuid(),
    'CC BY-ND 4.0',
    'https://creativecommons.org/licenses/by-nd/4.0/',
    'Attribution required, no derivatives permitted. Others may share this work unmodified with credit, including commercially.',
    'Use when you want wide distribution but need the content kept intact — e.g. official statements or policy documents.',
    NULL,
    7
  ),
  (
    gen_random_uuid(),
    'CC BY-NC-ND 4.0',
    'https://creativecommons.org/licenses/by-nc-nd/4.0/',
    'Most restrictive Creative Commons licence. Attribution required, non-commercial only, no derivatives permitted.',
    'Maximum control while still allowing sharing. Suitable for authored works where integrity and non-commercial use matter most.',
    NULL,
    8
  )
ON CONFLICT DO NOTHING;
