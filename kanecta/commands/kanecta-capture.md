Save the following to my Kanecta personal knowledge base:

$ARGUMENTS

Run this bash command and confirm what was saved:
```bash
kanecta capture "$ARGUMENTS"
```

If the user didn't specify a tag, infer a sensible one based on the content (e.g. `--tag decision`, `--tag bug-fix`, `--tag preference`, `--tag architecture`).
