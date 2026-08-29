# Contributing to this Project

Thank you for considering contributing to this project! To keep our history clean and understandable, we follow a clear set of guidelines for commit messages. Please read the instructions below to ensure your commit messages fit the expected format.

## Commit Message Guidelines

A good commit message should be clear and concise, describing what changed and why. This helps reviewers understand the scope and intent of your changes, and keeps our project's history easy to navigate.

### Format

Each commit message should consist of:

```
<type>(<scope>): <subject>
<BLANK LINE>
<body>
<BLANK LINE>
<footer>
```

- **type**: the category of the change, such as `feat`, `fix`, `docs`, `style`, `refactor`, `test`, or `chore`.
- **scope** (optional): a noun describing the section of the codebase affected (e.g., `ui`, `api`, `build`).
- **subject**: a short description of the change (max 50 characters), written in imperative mood (e.g., "Add", not "Added" or "Adds").
- **body** (optional): a more detailed explanatory text, wrapped at 72 characters.
- **footer** (optional): information about breaking changes or issues closed.

### Types

Here are some common types and their meanings:

- **feat**: a new feature
- **fix**: a bug fix
- **docs**: documentation only changes
- **style**: changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- **refactor**: a code change that neither fixes a bug nor adds a feature
- **test**: adding missing tests or correcting existing tests
- **chore**: changes to the build process or auxiliary tools and libraries

### Examples

```
feat(api): add user login endpoint

fix(ui): correct button alignment on dashboard

docs: update contributing guidelines with commit message rules

style: remove extra spaces in header component

refactor(auth): simplify token validation logic

test(auth): add tests for password reset flow

chore(deps): update dependency lodash to v4.17.21
```

### Additional Tips

- Use the imperative, present tense: "change" not "changed" nor "changes".
- Limit the subject line to 50 characters.
- Capitalize the subject line.
- Do not end the subject line with a period.
- Use the body to explain what and why vs how.
- Reference issues and pull requests liberally in the body or footer when relevant (e.g., `Closes #123`).

By following these commit message guidelines, we improve collaboration, review, and project maintenance over time. Thank you for helping us maintain a high-quality repository!

Happy contributing!