# Don't Break Me

This file is devs to call out critical things to consider before merging pull requests so we don't break critical functionality the others depend on.

## Community Hub must not break

Community Hub (kanecta/kanecta-apps/kanecta-app-community-hub) currently doesn't depend on the kanecta-api. But over the next few weeks/months it will be migrated to using the kanecta-api as its only backend. The featherston.co.nz town website depends on Community Hub, so making breaking changes to the kanecta-api and it's dependencies could break the live web app.

## Data format must not change in a breaking way

Thoughts on proposed breaking changes to the data format should go into:

`/path/to/kanecta/kanecta-specification/vNext`


