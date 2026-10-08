# Team commits: who commits what, and in what order

Four people, ten commits, one after another. Each commit adds a different set of files, so nobody gets merge conflicts. The app builds completely once commit 10 is pushed.

| Step | Who | What (files) | Commit message |
| --- | --- | --- | --- |
| 1 | **Sai Sri Ram Pitta** | Project setup: `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.mjs`, `vitest.config.mts`, `.gitignore`, `.env.example`, `LICENSE`, `start.bat`, `start.sh`, `start-lan.bat`, `setup-gemma.bat`, `setup-gemma.sh`, `scripts/launch.mjs`, `scripts/doctor.mjs`, `scripts/setup-gemma.mjs`, `public/` | chore: project setup, launcher and Gemma setup scripts |
| 2 | **Sai Sri Ram Pitta** | Calculation engine: `src/lib/types.ts`, `src/lib/engine/`, `src/lib/ledger.ts`, `tests/engine.test.ts` | feat(engine): dated IEEPA rate table, CBP interest, absorption ledger, leverage and settlement ladder |
| 3 | **Tanish Kinthali** | Document reading and Gemma: `src/lib/extraction/`, `tests/gemma.test.ts`, `tests/google.test.ts` | feat(extraction): document ingest, rules extractor, Gemma client (Ollama and Google AI Studio) and grounding check |
| 4 | **Tanish Kinthali** | Storage, queue and demo data: `src/lib/server/store.ts`, `pipeline.ts`, `buyers.ts`, `demo.ts`, `demo/`, `scripts/make-demo-docs.mjs`, `tests/pipeline.test.ts`, `tests/server.test.ts` | feat(server): workspace store, processing queue, buyer matching and demo dataset |
| 5 | **Harshith Reddy** | Login and security: `src/lib/auth/`, `src/lib/server/auth.ts`, `tenant.ts`, `api.ts`, `src/middleware.ts`, `src/app/api/auth/`, `src/app/api/health/`, `tests/auth.test.ts` | feat(auth): sign up and sign in, signed session cookies, page guard, per-company data isolation, health check |
| 6 | **Harshith Reddy** | API endpoints: `src/app/api/` buyers, demo, documents, engine, export, lines, portal, settings, workspace | feat(api): documents, buyers, ledger lines, settings, export, engine and buyer portal endpoints |
| 7 | **Adithya Bukkineni** | Design system and components: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/`, `src/lib/client.ts` | feat(ui): vibrant design system, app shell, proof drawer, refund estimator and live interest ticker |
| 8 | **Adithya Bukkineni** | Pages: `src/app/(app)/`, `welcome/`, `login/`, `signup/`, `claim/`, `r/` | feat(pages): landing, sign in, portfolio, intake, buyers, negotiation, pipeline, settings, claim pack and buyer portal |
| 9 | **Harshith Reddy** | Deployment: `render.yaml`, `docs/DEPLOY.md` | chore(deploy): Render blueprint with persistent disk and Gemma, deployment guide |
| 10 | **Sai Sri Ram Pitta** | Documentation: `README.md`, `docs/PITCH.md`, `docs/USER-GUIDE.md`, `docs/TEAM-COMMITS.md`, `scripts/team-commit.ps1` | docs: README in the hackathon template, pitch, user guide and team workflow |

The script `scripts/team-commit.ps1` contains exactly these lists. It copies the right files and makes the commit for you.

---

## Once, before anyone commits

**Sai Sri Ram (repository owner):**

1. On github.com click **+ → New repository**. Name it `clawback`, set it to **Public** (if the hackathon requires it), and **do not** tick "Add a README". Click **Create repository**.
2. In the repository, go to **Settings → Collaborators → Add people** and add Tanish, Adithya and Harshith by their GitHub usernames.
3. Send everyone the file **`ClawBack-final.zip`** (WhatsApp or Google Drive).

**Everyone (all 4):**

1. Accept the collaborator invite (from the email, or at github.com/notifications).
2. Install **Git for Windows** from https://git-scm.com/download/win, keeping the default options.
3. Open **PowerShell** and tell Git who you are. Use the **same email as your GitHub account**, or your commits won't show on your profile.
   ```powershell
   git config --global user.name "Tanish Kinthali"
   git config --global user.email "tanish@example.com"
   ```
4. Make a working folder **outside OneDrive**: in PowerShell run `mkdir C:\hack`. Right-click `ClawBack-final.zip` → **Extract All** → set the destination to exactly `C:\hack` → **Extract**. Check that `C:\hack\ClawBack-final\package.json` exists (not `ClawBack-final\ClawBack-final`).
5. Clone the repository into the same folder:
   ```powershell
   cd C:\hack
   git clone https://github.com/SAI-USERNAME/clawback.git clawback-repo
   ```
   This creates `C:\hack\clawback-repo`. It is empty at first, which is normal.

## Your turn (repeat for each of your steps)

Wait until the person before you says "pushed". Then, in PowerShell:

```powershell
cd C:\hack\clawback-repo
powershell -ExecutionPolicy Bypass -File C:\hack\ClawBack-final\scripts\team-commit.ps1 -Step 3 -Source C:\hack\ClawBack-final
git push
```

Change `-Step 3` to your step number. The script:

1. pulls the latest commits;
2. copies only your step's files;
3. commits them under your name with the message in the table.

The first `git push` opens a browser window to sign in to GitHub. Allow it.

**Step 1 only** (the repository is still empty): push with `git push -u origin main` instead of `git push`.

When you have pushed, message the group: "Step N pushed". The next person goes.

**Order:** Sai Sri Ram does 1 and 2, then Tanish does 3 and 4, then Harshith does 5 and 6, then Adithya does 7 and 8, then Harshith does 9, then Sai Sri Ram does 10.

## If something goes wrong

| Message | What to do |
| --- | --- |
| `git pull failed` | The previous person hasn't pushed yet, or you have local changes. Run `git status`. If you changed nothing on purpose, run `git reset --hard origin/main` and run the step again. |
| `nothing to commit` | That step is already committed (check the history on GitHub), so move on. |
| `Author identity unknown` | Do the `git config --global user.name` and `user.email` lines above. |
| `Permission denied` / 403 on push | Accept the collaborator invite, then push again and sign in as yourself. |
| `running scripts is disabled` | Use the full `powershell -ExecutionPolicy Bypass -File ...` line exactly as shown. |
| `Missing in the final folder: ...` | `-Source` points at the wrong folder. It must be `C:\hack\ClawBack-final`. |

**Without the script:** copy the files listed for your step from `C:\hack\ClawBack-final` into the same places in `C:\hack\clawback-repo` with File Explorer, then run:

```powershell
git add .
git commit -m "<message from the table>"
git push
```

Only copy your own step's files. `.gitignore` (step 1) keeps `node_modules`, `.next`, `data` and `.env.local` out of GitHub.

**Short on time (one laptop):** the person at the laptop can make all 10 commits, giving each its owner with `-Author`, for example:

```powershell
... team-commit.ps1 -Step 3 -Source "..." -Author "Tanish Kinthali <tanish-github-email>"
```

GitHub credits each commit to the member whose email matches.

## After step 10

- Check github.com/SAI-USERNAME/clawback. It should show the README and 10 commits from 4 people.
- Deploy on Render: [`DEPLOY.md`](DEPLOY.md), part 3.
- Later changes (the live URL in the README, for example): edit, `git add .`, `git commit -m "docs: add live URL"`, `git push`.
