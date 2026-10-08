# Deploy, run and use ClawBack

This guide has three parts:

1. **Gemma setup:** ClawBack needs Gemma 4 to read documents, either through Google AI Studio or Ollama on a laptop.
2. **Run on a laptop:** for development, and as a backup for the demo.
3. **Deploy on Render (paid):** the public link for judges. It is always on, so no UptimeRobot is needed.

Do the team commits first ([`TEAM-COMMITS.md`](TEAM-COMMITS.md)) so the GitHub repository is complete before you deploy.

---

## 1. Get Gemma (choose one)

| | Google AI Studio (Gemini API) | Ollama on your laptop |
| --- | --- | --- |
| Model | `gemma-4-26b-a4b-it` (or `gemma-4-31b-it`) | `gemma4:e4b` |
| Needs | A Google account and a free API key | About 10 GB download and 16 GB RAM (or an 8 GB GPU) |
| Internet | Yes | No, fully offline |
| Works on Render | **Yes, this is what the live site uses** | No (Render has no GPU) |

**Get a Google AI Studio key (2 minutes):** open https://aistudio.google.com/apikey, sign in with Google, click **Create API key**, and copy the key. Treat it like a password: never commit it to GitHub or share it in a screenshot.

---

## 2. Run on a laptop (Windows)

1. Install **Node.js 22 LTS** from https://nodejs.org (choose "LTS"), with default options.
2. Get the project folder: either the unzipped final folder or your clone of the GitHub repository.
3. Double-click **`setup-gemma.bat`**:
   - Type `1` for Google AI Studio, paste your key, and press Enter to keep `gemma-4-26b-a4b-it`. It checks the key and saves it to `.env.local`.
   - Or type `2` for Ollama. Install Ollama from https://ollama.com/download first; the script downloads `gemma4:e4b`.
4. Double-click **`start.bat`**. The first run installs dependencies and builds the app (2 to 4 minutes, needs internet).
   - The window shows **"Gemma is ready…"** in green. A red message means the key or Ollama is not working; run `setup-gemma.bat` again.
5. The browser opens http://localhost:3000. Click **Try the live demo**, or **Create a free account**.
6. The top bar should say **Extraction engine: gemma-4-26b-a4b-it** (or `gemma4:e4b`). In **Settings → Extraction engine**, **Test connection** and **Run Gemma self-test** confirm it.

Notes:

- The very first demo load sends the 30 demo documents through Gemma, which takes a few minutes. The portfolio fills in as they are read ("Reading documents, N waiting"). Results are cached, so later demos load instantly.
- The ClawBack folder is on OneDrive. If installing is slow, pause OneDrive or move the folder to `C:\ClawBack`.
- macOS or Linux: run `./setup-gemma.sh`, then `./start.sh`.
- Commands, in any terminal: `npm run setup:gemma`, `npm install`, `npm run build`, `npm start`, and `npm test` (37 tests).

---

## 3. Deploy on Render (paid, using your $50 credit)

What `render.yaml` creates:

- a **Starter** web service, which is always on and never sleeps, so you don't need UptimeRobot;
- a **1 GB persistent disk** at `/var/data`, so accounts, uploads and the Gemma cache survive restarts and redeploys;
- Gemma 4 through Google AI Studio, using your key.

**Cost:** about $7 a month for Starter plus $0.25 a month for the disk, so $50 lasts roughly 6 months. Check the current prices on the Render pricing page before you confirm.

### Steps

1. Make sure all 10 team commits are pushed. The repository on GitHub must contain `render.yaml`.
2. Go to https://dashboard.render.com and sign in to the account that has the credit.
3. Connect GitHub if you haven't already: **Account settings → Git providers → GitHub → Connect**. Give the Render GitHub app access to the `clawback` repository.
   - The repository belongs to Sai Sri Ram. If someone else's Render account is used, Sai Sri Ram must allow that account's Render app on the repository, or make the repository public.
4. Click **New +** (top right) and choose **Blueprint**.
5. Select the `clawback` repository and click **Connect**.
6. Render reads `render.yaml` and shows one web service, **clawback**: Starter plan, Singapore region, with a disk called `clawback-data`.
7. Render asks for **`GEMMA_API_KEY`**. Paste your Google AI Studio key.
8. Give the blueprint a name (e.g. `clawback`) and click **Apply** (or **Deploy Blueprint**). Confirm the paid plan if asked.
9. Open the **clawback** service and go to **Logs**. The build runs `npm ci && npm run build` and takes 4 to 7 minutes. It is done when the status at the top says **Live**.
10. Copy your URL from the top of the service page, e.g. `https://clawback-xxxx.onrender.com`.
11. Check it:
    - Open `https://YOUR-URL/api/health`. You should see `"status":"ok"` and `"gemma":{"provider":"google","model":"gemma-4-26b-a4b-it"}`.
    - Open `https://YOUR-URL`. The landing page appears.
12. **Warm up the demo (do this once, at least 15 minutes before judging):** click **Try the live demo** and leave the tab open until the top bar no longer shows "Reading documents" (about 3 to 6 minutes). Gemma's readings are now cached on the disk, so every judge's demo loads instantly.
13. Put the URL in `README.md` under **Working Application** and on Devpost. Commit that change (any member) and Render redeploys automatically.

### If you prefer to set it up by hand (no Blueprint)

1. **New + → Web Service →** pick the `clawback` repository.
2. **Name** `clawback`, **Region** Singapore, **Branch** `main`, **Runtime** Node.
3. **Build Command** `npm ci && npm run build`. **Start Command** `npm run start:render`.
4. **Instance Type:** Starter.
5. **Environment variables:**
   - `NODE_VERSION` = `22`
   - `CLAWBACK_DATA_DIR` = `/var/data`
   - `AUTH_SECRET` = click **Generate**
   - `CLAWBACK_ENGINE_MODE` = `auto`
   - `GEMMA_PROVIDER` = `google`
   - `GEMMA_MODEL` = `gemma-4-26b-a4b-it`
   - `GEMMA_API_KEY` = your key
6. **Advanced → Health Check Path** = `/api/health`.
7. **Advanced → Add Disk:** name `clawback-data`, mount path `/var/data`, size 1 GB.
8. Click **Create Web Service**, then follow steps 9 to 13 above.

### Good to know

- **Every push to `main` redeploys automatically.** A service with a disk is offline for about a minute while it restarts, so don't push during judging.
- **Changing the key or model:** service → **Environment** → edit → **Save changes**. Render redeploys.
- **Rate limits:** free Google AI Studio keys have per-minute limits. ClawBack retries automatically, and if Gemma still can't answer, the rules engine reads that document and flags it. For heavy use, enable billing on the key in Google AI Studio.
- **Custom domain (optional):** service → **Settings → Custom Domains**.
- **Backups:** each account can download its workspace in **Settings → Data**.

---

## Checklist before judging

- [ ] `https://YOUR-URL/api/health` shows `"status":"ok"` and the Gemma model
- [ ] Demo warmed up once: **Try the live demo** now loads the full portfolio instantly
- [ ] The top bar shows **Extraction engine: gemma-4-26b-a4b-it**
- [ ] README has the live URL, demo video and Devpost link
- [ ] A laptop with `start.bat` working, as a backup
