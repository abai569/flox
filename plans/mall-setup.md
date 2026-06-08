# Mall Private Repo Setup

## 1. Create private repo on GitHub

```bash
gh repo create abai569/flvx-mall --private --description "FLVX mall/shop system source code"
```

Or create manually at https://github.com/new (name: `flvx-mall`, private).

## 2. Push mall content

```bash
cd mall
git remote add origin https://github.com/abai569/flvx-mall.git
git push -u origin master
```

## 3. Create GitHub Personal Access Token

1. https://github.com/settings/tokens -> Generate new token (classic)
2. Scopes: `repo` (full control)
3. Copy the token

## 4. Add secret to flvx repo

1. https://github.com/abai569/flvx/settings/secrets/actions -> New repository secret
2. Name: `MALL_REPO_PAT`
3. Value: (paste the token from step 3)

## Done

After these steps, CI (`docker-build.yml`) will:
1. Check out `abai569/flvx-mall` using the PAT
2. Run `merge-mall.ps1` to restore mall files
3. Build Docker images with mall features included
