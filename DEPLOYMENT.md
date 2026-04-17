# GitHub Pages Deployment Guide

## Quick Setup

Your Bowhead Whale Piano is ready to deploy to GitHub Pages! Follow these steps:

### 1. Create a GitHub Repository

1. Go to [https://github.com/new](https://github.com/new)
2. Name your repository (e.g., `bowhead-whale-piano` or `BowheadRingtones`)
3. Choose **Public** (required for free GitHub Pages)
4. **Do NOT** initialize with README, .gitignore, or license (we already have those)
5. Click "Create repository"

### 2. Push Your Code to GitHub

After creating the repository, run these commands in your terminal:

```bash
# Add your GitHub repository as the remote origin
# Replace YOUR_USERNAME and REPO_NAME with your values
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# Push your code to GitHub
git push -u origin main
```

Example:
```bash
git remote add origin https://github.com/oceaneboulais/bowhead-whale-piano.git
git push -u origin main
```

### 3. Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** (in the repository menu)
3. Click **Pages** (in the left sidebar)
4. Under "Source", select:
   - Branch: **main**
   - Folder: **/ (root)**
5. Click **Save**

### 4. Access Your Live Site

After a few minutes, your site will be available at:
```
https://YOUR_USERNAME.github.io/REPO_NAME/
```

For example:
```
https://oceaneboulais.github.io/bowhead-whale-piano/
```

GitHub will show you the exact URL on the Pages settings page.

## Custom Domain (Optional)

If you want to use a custom domain like `whale-piano.yourdomain.com`:

1. Add a `CNAME` file to your repository with your domain
2. Configure DNS settings with your domain provider
3. See [GitHub's custom domain documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)

## Using Your GitHub Pages URL

To make it your profile site (`https://YOUR_USERNAME.github.io`), you need to:
1. Create a repository named exactly `YOUR_USERNAME.github.io`
2. Push your code there
3. It will automatically be available at `https://YOUR_USERNAME.github.io`

## What's Included

Your deployment includes:
- All HTML, CSS, and JavaScript files
- 88 whale sound clips (17MB total)
- Spectrogram visualizations (35MB)
- The `.nojekyll` file (prevents Jekyll processing)

## What's Excluded

To keep the repository size manageable:
- Original 14GB of source wav files
- Backup files
- Python virtual environment
- Node modules

## Updating Your Site

To update your live site, just commit and push:

```bash
git add .
git commit -m "Update whale piano"
git push
```

GitHub Pages will automatically rebuild and deploy within a few minutes.

## Troubleshooting

**Site not loading?**
- Wait 3-5 minutes after first deployment
- Check Settings > Pages for deployment status
- Ensure repository is Public

**Sounds not playing?**
- Check browser console for errors
- Ensure .WAV files are committed to git
- Try clearing browser cache

**Changes not appearing?**
- Wait a few minutes for GitHub Pages to rebuild
- Do a hard refresh (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)

## Need Help?

Check the [GitHub Pages documentation](https://docs.github.com/en/pages) for more details.
