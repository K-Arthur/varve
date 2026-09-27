# Local plugin E2E fixtures

The analysis and rename archives are copied from the public SDK examples so
the browser tests exercise the same manifests, ABI, and compiled guest modules
that developers install. Rebuild them from the repository root after changing
an example:

```bash
node examples/plugins/build.mjs
python3 tests/e2e/plugins/fixtures/build-package-fixtures.py
python3 tests/e2e/plugins/fixtures/build-update-fixture.py
python3 tests/e2e/plugins/fixtures/build-long-name.py
python3 tests/e2e/plugins/fixtures/build-fault-loop.py
python3 tests/e2e/plugins/fixtures/build-fault-loop.py --second
```

The loop packages are deliberately nonterminating guests. Install and execute
them only through the isolated plugin Worker in the E2E suite; never instantiate
their Wasm modules directly. Run the static package validator over every
`*.varveplugin` fixture before committing regenerated archives.
