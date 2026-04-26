# release-manager

Release SOP walker — bump → tag → bundle → publish → deploy → announce. The skill bundle Forge composes for end-to-end releases.

## Status

**Phase 1 (this scaffold):** repo bootstrapped per [`compass/metafactory/sops/new-repo.md`](https://github.com/the-metafactory/compass/blob/main/metafactory/sops/new-repo.md).

**Phase 3 (next):** workflows + scripts implementation. See [Iteration 1 issue](../../issues) for the full checklist.

Day-one scope: **grove only**. Generalising the workflows to other ecosystem repos is a Phase G iteration — do not add per-repo branching to workflows in Phase 3.

## Cross-references

- **[forge#1](https://github.com/the-metafactory/forge/issues/1)** (merged) — agent platform + Forge design naming the ReleaseManager workflows + scripts.
- **[meta-factory#390](https://github.com/the-metafactory/meta-factory/issues/390)** — platform iteration plan; this repo is Phase 3.

## What ships in the bundle (Phase 3 target)

Per [arc#100] §12 packaging convention:

```
release-manager/
├── arc-manifest.yaml
├── skill/
│   ├── SKILL.md                 triggers: release, bump version, cut release, ...
│   ├── Workflows/
│   │   ├── BumpVersion.md
│   │   ├── CutRelease.md
│   │   ├── TrustGateCheck.md
│   │   ├── DeployStaged.md
│   │   ├── Rollback.md
│   │   ├── Announce.md
│   │   └── ScaffoldInstance.md  calls AgentState/ScaffoldFolders
│   └── (Workflows reference scripts/* below)
├── scripts/
│   ├── list-releases-since-tag.ts
│   ├── prepare-changelog.ts
│   └── check-gate-table.ts
└── context/
    └── release-conventions.md
```

Authority lives in the host (`bot.yaml`), not in the bundle.

## License

MIT — see [LICENSE](./LICENSE).
