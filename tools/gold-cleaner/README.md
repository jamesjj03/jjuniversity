# JJU Gold Cleaner

Local-only Gold Edition style cleanup workbench.

## Run

```powershell
npm.cmd run gold-cleaner
```

Then open:

```text
http://localhost:4343
```

## Inputs

- Reads book JSON from `private/book-content/*.json`.
- Uses `jju-gold-audit.json` or `gold-audit.json` if one is placed in the repo root, `public/`, or this tool folder.
- Also checks `C:\Users\JJ\Downloads\jju-gold-audit.json` by default on this machine.
- You can override the audit path with `GOLD_AUDIT_FILE`.
- If no audit file is present, it computes a basic residue scan from the book text.

## AI Keys

AI calls are made server-side from this local Node tool.

Set either:

```powershell
$env:ANTHROPIC_API_KEY="..."
npm.cmd run gold-cleaner
```

or:

```powershell
$env:OPENAI_API_KEY="..."
npm.cmd run gold-cleaner
```

Optional model overrides:

```powershell
$env:ANTHROPIC_MODEL="claude-sonnet-4-6"
$env:OPENAI_MODEL="gpt-5.1"
```

## Outputs

Original files are never overwritten.

`*.gold.json` exports are real fixed JSON files: cleaned sections replace `html` and `text`, while `originalHtml` and `originalText` are kept as a backup inside each cleaned section.

Use **Update Live JSON** when you want the tool to overwrite the actual `private/book-content/*.json` file. The tool writes a timestamped backup to `tools/gold-cleaner/gold-output/backups/` before changing the live file.

Drafts and exports save to:

```text
tools/gold-cleaner/gold-output/
```
