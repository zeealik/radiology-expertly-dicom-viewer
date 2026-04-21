# Fork Management Strategy: Keeping Custom Tweaks While Syncing Upstream

## Overview
This document outlines the strategy for maintaining a forked repository (`radiology-expertly-dicom-viewer`) based on the upstream (`OHIF/Viewers`) while adding custom tweaks to your main branch. This approach ensures you can:
- Merge upstream updates into your fork
- Keep your custom tweaks separate and safe
- Maintain a clean history
- Avoid merge conflicts

---

## 1. Initial Setup (One-Time)

### 1.1 Add Upstream Remote
If you haven't already, add the original repository as a remote called "upstream":

```bash
git remote add upstream https://github.com/OHIF/Viewers.git
```

### 1.2 Verify Remotes
Confirm you have both remotes configured:

```bash
git remote -v
```

Expected output:
```
origin    https://github.com/zeealik/radiology-expertly-dicom-viewer.git (fetch)
origin    https://github.com/zeealik/radiology-expertly-dicom-viewer.git (push)
upstream  https://github.com/OHIF/Viewers.git (fetch)
upstream  https://github.com/OHIF/Viewers.git (nofetch)
```

### 1.3 Fetch Upstream Data
```bash
git fetch upstream
```

---

## 2. Branch Strategy

### 2.1 Recommended Branch Structure

```
main
├── upstream tracking (merge-only from upstream)
└── feature/custom-tweaks (your customizations)
```

### 2.2 Create a Tweaks Branch (If Not Already Done)
If you want to keep your customizations isolated:

```bash
git checkout -b feature/custom-tweaks main
```

Or, if your tweaks are already in `main`, create a separate branch for future changes:

```bash
git checkout main
git checkout -b feature/custom-tweaks
```

---

## 3. Workflow: Getting Upstream Updates

### 3.1 Fetch Latest Upstream Changes
```bash
git fetch upstream
```

### 3.2 Update Your Main Branch with Upstream
Navigate to your main branch:

```bash
git checkout main
```

Merge upstream changes into main:

```bash
git merge upstream/main
```

### 3.3 Resolve Conflicts (If Any)
If conflicts occur:

```bash
# View conflicted files
git status

# Edit conflicted files and resolve manually
# Look for markers: <<<<<<, ======, >>>>>>

# After resolving
git add <resolved-files>
git commit -m "Merge upstream updates - resolved conflicts"
```

### 3.4 Push to Your Origin
```bash
git push origin main
```

---

## 4. Workflow: Adding Your Custom Tweaks

### 4.1 Create Feature Branches for Each Tweak
For each customization, create a separate feature branch:

```bash
git checkout main
git checkout -b feature/custom-tweak-name
```

### 4.2 Make Your Changes
Edit files, commit as usual:

```bash
git add <files>
git commit -m "Add custom tweak: [description]"
```

### 4.3 Push Feature Branch
```bash
git push origin feature/custom-tweak-name
```

### 4.4 Merge to Main via Pull Request (Optional but Recommended)
- Go to GitHub
- Create a Pull Request from `feature/custom-tweak-name` → `main`
- Review and merge
- This maintains a clean history

Or merge locally:

```bash
git checkout main
git merge feature/custom-tweak-name
git push origin main
```

---

## 5. Workflow: Handling Merge Conflicts Between Tweaks and Upstream

### 5.1 If Conflicts Occur When Merging Upstream

**Scenario:** You merged upstream/main into main, but it conflicts with your tweaks.

```bash
git checkout main
git merge upstream/main
# Conflicts detected!
```

### 5.2 Resolve Conflicts Manually

1. **Identify conflicted files:**
   ```bash
   git status
   ```

2. **Edit each conflicted file** and choose:
   - Keep your changes
   - Keep upstream changes
   - Combine both intelligently

3. **Mark as resolved:**
   ```bash
   git add <resolved-files>
   git commit -m "Merge upstream updates with custom tweaks - resolved [specific areas]"
   ```

### 5.3 Test After Merging
Always test your application after merging upstream to ensure:
- Build still works: `npm run build` (or your build command)
- No runtime errors
- Custom tweaks still function

```bash
npm install  # In case dependencies changed
npm run build
npm run test  # If you have tests
```

---

## 6. Advanced: Using Rebase for Cleaner History (Optional)

If you prefer a linear history, use rebase instead of merge:

```bash
git checkout main
git fetch upstream
git rebase upstream/main
```

**Warning:** Only use rebase if:
- You haven't pushed yet, OR
- You force-push (and no one else is working on main)

For public repos with others, use **merge** (Section 3.2).

---

## 7. Documentation: Tracking Your Custom Tweaks

### 7.1 Create a CUSTOM_TWEAKS.md File
In your repository root, document all your custom modifications:

```markdown
# Custom Tweaks

## List of Customizations

### 1. Tweak: [Name]
- **Branch:** feature/custom-tweak-name
- **Purpose:** [What it does]
- **Modified Files:**
  - src/file1.js
  - src/file2.jsx
- **Date Added:** YYYY-MM-DD
- **Notes:** Any special notes about merge conflicts or compatibility

### 2. Tweak: [Name]
...
```

### 7.2 Create a MERGE_CHECKLIST.md File
Document steps to follow when merging upstream:

```markdown
# Pre-Merge Checklist

- [ ] Fetch upstream: `git fetch upstream`
- [ ] Review upstream changes: `git log --oneline main..upstream/main`
- [ ] Create backup branch: `git checkout -b backup/main-$(date +%Y%m%d)`
- [ ] Checkout main: `git checkout main`
- [ ] Merge upstream: `git merge upstream/main`
- [ ] Check for conflicts: `git status`
- [ ] Resolve any conflicts
- [ ] Run tests: `npm run test`
- [ ] Run build: `npm run build`
- [ ] Test application manually
- [ ] Push to origin: `git push origin main`
```

---

## 8. Example: Complete Workflow

### Scenario: You want to update from upstream and add a new tweak

```bash
# Step 1: Fetch latest upstream
git fetch upstream

# Step 2: Update main
git checkout main
git merge upstream/main
# Resolve any conflicts if they occur

# Step 3: Test
npm install
npm run build

# Step 4: Push updated main
git push origin main

# Step 5: Create new tweak branch
git checkout -b feature/add-custom-toolbar
# ... make changes ...
git add .
git commit -m "Add custom toolbar UI"
git push origin feature/add-custom-toolbar

# Step 6: Merge back to main
git checkout main
git merge feature/add-custom-toolbar
git push origin main

# Step 7: Delete feature branch (optional)
git branch -d feature/add-custom-toolbar
git push origin --delete feature/add-custom-toolbar
```

---

## 9. Troubleshooting

### Problem: Too Many Conflicts When Merging
**Solution:** Use a fresh branch approach
```bash
git checkout -b main-new upstream/main
# Manually re-apply your tweaks to this branch
# Test thoroughly
# Then replace main: git branch -M main-new main
# git push -f origin main  # Use force only if necessary
```

### Problem: Lost Track of Your Custom Changes
**Solution:** See diff against upstream
```bash
git diff upstream/main..main
```

### Problem: Need to Undo a Merge
**Solution:** Reset to before the merge
```bash
git reset --hard HEAD~1
# Or use git revert if already pushed
git revert -m 1 <merge-commit-hash>
```

---

## 10. Best Practices Summary

1. **Always fetch before work:** `git fetch upstream`
2. **Use feature branches** for each tweak
3. **Commit messages should be clear** about what you changed
4. **Document your tweaks** in CUSTOM_TWEAKS.md
5. **Test after every upstream merge**
6. **Use Pull Requests** on GitHub for visibility
7. **Keep main in sync** with upstream regularly (weekly/biweekly)
8. **Create backup branches** before major merges
9. **Monitor upstream releases** and changelog
10. **Communicate** with team about custom modifications

---

## 11. Integration with Claude VS Code Extension

The Claude extension in VS Code can reference this document when:
- Making commits (to follow the documented strategy)
- Creating branches (to use naming conventions)
- Merging code (to check for conflicts)

**How to reference this guide:**
- Pin this file in your workspace
- Reference it when asking Claude to help with: "Following FORK_SYNC_STRATEGY.md, please..."
- Let Claude learn your conventions by consistently using this workflow

---

## Quick Reference: Common Commands

```bash
# Fetch upstream changes
git fetch upstream

# Check what's new in upstream
git log --oneline main..upstream/main

# Merge upstream to main
git checkout main && git merge upstream/main

# Create backup before major merge
git checkout -b backup/main-$(date +%Y%m%d)

# Create new feature branch
git checkout -b feature/description-of-change

# Push branch
git push origin feature/description-of-change

# Check remote status
git remote -v

# See current differences from upstream
git diff upstream/main..main

# View merge history
git log --oneline --graph --all
```

---

**Last Updated:** 2026-04-21
**Repository:** radiology-expertly-dicom-viewer
**Upstream:** OHIF/Viewers
