BulkSend final verification — 2026-09-13

PASS: Pinned canonical build and full verify.sh workflow tests.
PASS: Mainnet runtime byte-for-byte equivalence, corroborated by two RPC endpoints.
PASS: Deployment creation code, constants and absence of constructor arguments/immutables.
PASS: Frontend deployment address, ABI/selectors and served artifact consistency.
PASS: WalletConnect bundle reproducibility and all four mainnet fork tests.

Test results: 417 airdrop browser checks, 151 Check-page checks, 77 reader checks,
42 worker checks, 21 CSP gate checks, 6/6 ordinary contract suites, and all
historical probe fingerprints matched their recorded baseline.

Two exceptions to an unmodified end-to-end workflow run:
1. The CI OS-dependency installer required a sudo password. Pinned Chromium and
   all suites passed using the host's existing system dependencies.
2. Standalone live-chain.mjs supplied testnet tokens while the page defaulted to
   mainnet. All four cases passed with the repository's existing testnet fixture.
   This is a test-harness setup issue, not a production deployment mismatch.

No production code changed and no transactions were broadcast.
No contract change or redeployment is required. For future verification, use an
appropriately privileged CI runner and select testnet for the live-chain harness.

final-results.json is the structured summary; verify.log contains the completed
verification run and baseline checks. Other logs preserve the specific checks,
including the original integration failure and its successful fixture-based rerun.
Deployment receipt, transaction and runtime bytes are included as supporting evidence.
