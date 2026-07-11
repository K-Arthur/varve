# CI Failure Debug Report

**Repository:** K-Arthur/Strata
**Workflow:** Website Deploy
**Run:** [29049933167](https://github.com/K-Arthur/Strata/actions/runs/29049933167)
**Branch:** master
**Commit:** ac6c8cd317040086794f6b0f2775bc1692d07ca1
**Conclusion:** failure
**Created:** 2026-07-09T21:01:09Z

## Failed jobs
- **build** (failure)
  - 3. Setup Node: failure

## Failure snippets

### build
- line 0: `Job concluded as failure but no log text was downloaded.`
  <details><summary>context</summary>

```

```
  </details>


## Local reproduction

```bash
# Run the failing gate locally
just gate

# Or reproduce a specific job with act
just act-run js
```