---
name: init
description: Understand this Electron + React + SQLite invoicing project, then create or refine project skills and update README documentation. Use when the user runs /init or asks for project initialization, onboarding context, skill setup, or README sync.
---

# Init Project Skill

## Goal
Establish reliable project context before making changes, then keep local skills and README aligned with the current implementation.

## Workflow
Follow this checklist in order:

1. **Read baseline context**
   - Read `README.md`
   - Read `package.json`
   - Read `src/main/main.js`, `src/main/ipcHandlers.js`, and `src/main/database.js`
   - Read `src/renderer/App.jsx` and key page/component files under `src/renderer/`
   - If present, read `.cursor/skills/**/SKILL.md` to avoid duplicate or conflicting skills

2. **Summarize project understanding**
   - Capture stack, runtime model, and major modules
   - Capture primary data flow (renderer -> preload -> IPC -> SQLite)
   - Capture high-impact business rules already implemented
   - Keep this summary concise and action-oriented

3. **Create or update skills**
   - If requested, create a new project skill under `.cursor/skills/<skill-name>/SKILL.md`
   - Keep YAML frontmatter valid and concise (`name`, `description`)
   - Use concrete triggers in the description so the skill is discoverable
   - Prefer one clear default workflow over many alternatives

4. **Update README**
   - Ensure README includes:
     - quick start commands
     - core architecture summary
     - where skills live (`.cursor/skills/`)
     - how to invoke the relevant skill (example: `/init`)
   - Keep wording consistent with actual files and scripts

5. **Validate consistency**
   - Verify commands in README exist in `package.json`
   - Verify referenced files/routes/components exist
   - Avoid documenting features that are not implemented

## Output format
When finishing `/init`, return:

- short project understanding (stack + architecture + major modules)
- files created/updated
- any mismatches found between docs and code
- next recommended step

## Guardrails
- Do not invent APIs, tables, or routes that are not present in the codebase.
- Do not overwrite unrelated user changes.
- Keep edits minimal and focused on initialization and documentation quality.
