# Working on this repo

This project is co-developed with ChatGPT, which publishes its version of the source at
https://babylon-workbench-starter.gardengrass19.chatgpt.site/app-source.zip and can pull
this repo to start from our changes. `main` is the branch we manage.

Before starting any task, merge upstream first:

    tools/sync-upstream.sh

It records the archive as an `upstream snapshot` commit (tree = archive contents,
parented on the previous snapshot) and merges it into the current branch. Resolve any
conflicts, keeping both sides' intent, before doing other work. Never edit or rewrite
snapshot commits; never add a snapshot by hand.

Then: `npm ci`, `npm test`, `npm run dev`. Commit and push to `main` when done.

## Writing style for docs

In all project docs (README, docs/, example READMEs, comments meant as docs): no emoji, no em
dashes or en dashes, no arrow glyphs (write menu paths as `File > Export`), and no AI-style
filler or flourishes. Keep prose short, plain and factual.

## Code style

Less is more. Write DRY, readable, self-documenting code: clear names and small functions instead of comments.
Comment only what the code cannot say (a non-obvious reason or constraint), in one line. Tidy as you go:
remove clutter, bloat, dead code and code your change replaces whenever you see it.
