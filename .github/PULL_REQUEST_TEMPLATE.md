## What changed

<!-- Explain the problem and why this is the smallest complete fix. -->

## Verification

- [ ] `npm run lint && npm run typecheck && npm test && npm run build`
- [ ] `cd mobile && npm run lint && npm run typecheck && npm test && npm run config:check`
- [ ] I added or updated tests for behavior changes
- [ ] I updated user or deployment documentation where needed

## Safety

- [ ] No secrets, credentials, live provider IDs, or generated native output are included
- [ ] Provider-specific behavior remains isolated from the core runtime
- [ ] This change does not weaken authentication, fork-PR safety, or non-root execution
- [ ] Native changes were rebuilt and tested on the affected physical device(s), or marked N/A

<!-- Mark an item N/A and explain when it does not apply. -->
