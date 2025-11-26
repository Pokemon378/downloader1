# Railway Deployment Guide

Follow these steps to deploy your Universal Downloader to Railway.

## Prerequisites
- A [Railway](https://railway.app/) account.
- GitHub account (recommended) or Railway CLI.

## Deployment Steps

1.  **Push to GitHub**:
    - Ensure your code is pushed to a GitHub repository.

2.  **Create New Project on Railway**:
    - Go to your Railway Dashboard.
    - Click **New Project** -> **Deploy from GitHub repo**.
    - Select your repository.

3.  **Configure Service**:
    - Railway will automatically detect the `Dockerfile`.
    - It will build the image, installing Node.js, Python, FFmpeg, and yt-dlp.

4.  **Environment Variables (Optional)**:
    - If you want to customize the port (default is 3000), go to **Variables** and add `PORT`.
    - Railway automatically sets `RAILWAY_ENVIRONMENT`, so our code knows to use the Linux paths.

5.  **Generate Domain**:
    - Go to **Settings** -> **Networking**.
    - Click **Generate Domain** to get a public URL (e.g., `xxx.up.railway.app`).

6.  **Update Frontend**:
    - If you are hosting the frontend separately (e.g., Firebase), update `script.js` to point to this new Railway URL.
    - **However**, since this project serves the frontend from `server.js` (via `express.static`), you can just use the Railway URL directly!

## Verification
- Visit your Railway URL.
- Try downloading a video. The server will handle the download using the installed tools.
