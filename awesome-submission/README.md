# Submit dsh-db to awesome-dsh-plugin

Guide: <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md>

The submission is **one YAML file** in the upstream repository:

```
data/plugins/blackstone-leixin__dsh-db.yml
```

The prepared file is next to this guide: [`blackstone-leixin__dsh-db.yml`](./blackstone-leixin__dsh-db.yml).
The prepared PR body is [`PR_BODY.md`](./PR_BODY.md).

## Before opening the PR

1. **Wait until the repository is at least 1 day old.** The upstream CI checks the GitHub repository age. The repository was created on 2026-10-29; wait until at least 2026-10-30 (24 hours after creation). A PR opened earlier gets a red age check.
2. **Add the `dsh-plugin` topic** to <https://github.com/blackstone-leixin/dsh-db>:
   - GitHub UI: repository → **About** ⚙️ → **Topics** → add `dsh-plugin`, `database`, `mysql`, `postgresql`, `deepseek-harness`.
   - or with GitHub CLI:
     ```powershell
     gh repo edit blackstone-leixin/dsh-db --add-topic dsh-plugin --add-topic database --add-topic mysql --add-topic postgresql --add-topic deepseek-harness
     ```
3. Confirm the repository root has `package.json` with `dsh.bundle` and `cordis.patch.yml`. It does.

## Fork, add the file, open the PR

### With GitHub CLI

```powershell
gh auth status
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
cd awesome-dsh-plugin
git checkout -b add-blackstone-leixin-dsh-db

Copy-Item "C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-db\awesome-submission\blackstone-leixin__dsh-db.yml" "data\plugins\"

git add data/plugins/blackstone-leixin__dsh-db.yml
git commit -m "Add blackstone-leixin/dsh-db"
git push -u origin add-blackstone-leixin-dsh-db

gh pr create `
  --repo awesome-dsh-plugin/awesome-dsh-plugin `
  --base main `
  --head blackstone-leixin:add-blackstone-leixin-dsh-db `
  --title "Add blackstone-leixin/dsh-db" `
  --body-file "C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-db\awesome-submission\PR_BODY.md"
```

### Without GitHub CLI

1. Fork <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/fork>.
2. Clone your fork and create a branch:
   ```powershell
   cd C:\Users\Administrator\Documents
   git clone git@github.com:blackstone-leixin/awesome-dsh-plugin.git
   cd awesome-dsh-plugin
   git checkout -b add-blackstone-leixin-dsh-db
   ```
3. Copy the prepared entry:
   ```powershell
   Copy-Item "C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-db\awesome-submission\blackstone-leixin__dsh-db.yml" "data\plugins\"
   ```
4. Commit and push:
   ```powershell
   git add data/plugins/blackstone-leixin__dsh-db.yml
   git commit -m "Add blackstone-leixin/dsh-db"
   git push -u origin add-blackstone-leixin-dsh-db
   ```
5. Open the compare page and click **Create pull request**:
   <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/compare/main...blackstone-leixin:add-blackstone-leixin-dsh-db?expand=1>
6. Paste the contents of `PR_BODY.md` into the description.

## CI / review notes

- The PR must add **only** `data/plugins/blackstone-leixin__dsh-db.yml`; do not edit the generated READMEs.
- CI checks `dsh.bundle`, repository age, YAML/`awesome-lint`, and that the READMEs regenerate.
- If a maintainer adds `held: author`, push fixes to the same branch and leave one comment describing them.
- `category: tools` is the closest fit (Tools & Capabilities). A maintainer may re-file it; that is not a rejection.
- The description states four agent tools; the code has exactly `db_list`, `db_search`, `db_schema`, `db_query`.
