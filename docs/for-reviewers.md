# What to look at, and how to run it

## The thing that matters

`src/BulkSend.sol`, about 300 lines. It is deployed at
[`0xc2e4a9C4c9215600d1B348d02b63C6148d0Ef481`](https://explorer.testnet.chain.robinhood.com/address/0xc2e4a9C4c9215600d1B348d02b63C6148d0Ef481)
on Robinhood Chain testnet, verified, and its runtime bytecode is byte-for-byte equal to what this repository
builds. Check that yourself:

    forge build
    cast code 0xc2e4a9C4c9215600d1B348d02b63C6148d0Ef481 --rpc-url https://rpc.testnet.chain.robinhood.com
    # compare with out/BulkSend.sol/BulkSend.json -> deployedBytecode.object

The two pages under `web/` are what people actually use, and the live copies are byte-identical to the files
here:

    curl -s https://rhairdrop.gmgnrepeat.com/ | cmp - web/index.html
    curl -s https://rhcheck.gmgnrepeat.com/   | cmp - web/check.html

## Running everything

    forge test                    # 110 contract tests, plus 29 reviewer probes of which 9 must fail
    npm install && npm test       # 441 browser tests, all answers mocked, no network
    ./test.sh                     # both of the above

The browser tests answer every RPC, explorer and price request from the test file itself, so a failure is the
page's fault and nothing else. Many test names begin with an audit finding id; that test is what stops the
finding coming back.

## What is in scope

- `src/BulkSend.sol` — the contract. No owner, no upgrade path, no fees, no pause, no stored state. Every
  transfer is `transferFrom(msg.sender, …)`.
- `web/index.html` — the airdrop page. Builds and sends batches. This is where the double-payment and
  silent-underpayment risks live, and where the previous audit found most of its High findings.
- `web/check.html` — a read-only page. Signs nothing, sends nothing, writes nothing.
- `deploy/publish.sh` — builds a Cloudflare Worker with the page inlined and uploads it.

## What is deliberately not in scope

- `lib/` — vendored dependencies (OpenZeppelin, ERC721A, forge-std), used only by the tests and by the
  rehearsal tokens. They are committed rather than fetched as submodules so that the source which produced
  the deployed bytecode is present in the repository, with no version to resolve and nothing to drift.
- `src/research/` — two EIP-7702 proof contracts. Not deployed, not referenced by anything, not part of the
  tool. See the README in that directory.
- `script/Rehearsal.s.sol` and `test/RealTokens.sol` — throwaway testnet tokens and hostile fixtures.

## Design decisions worth arguing with

These are choices, not accidents, and a reviewer disagreeing with one is useful.

1. **Ownerless and with no rescue function.** Assets sent to the contract by mistake are gone. The contract
   refuses itself as a recipient in all three methods, and the page refuses it before parsing finishes, which
   is a cheaper fix than a privileged role.
2. **The zero address is refused, never burned.** Strict mode reverts, lenient mode skips and logs.
3. **Ambiguous ERC-20 results revert the whole batch, in both modes, and a returned `false` is treated as
   ambiguous even though the standard defines it.** Reporting a possible payment as a skip is worse than
   failing. The `false` half of that is the part worth arguing with, and round twelve did argue with it: ERC-20
   defines `false` as "I did not transfer", so a conforming token answering it has moved nothing, and skipping
   that row is what lenient mode is for. That reasoning is correct about conforming tokens, and BulkSend has no
   way to know it is holding one. `PaysThenLies20` in `test/RealTokens.sol` moves the balance and *then*
   answers `false`; from inside the call there is nothing to tell it apart from a blocklist refusing a
   recipient, short of reading every balance before and after, which costs more gas than the transfers. So the
   two collapse into one case and the batch comes down, because a recipient who was paid must never be listed
   as skipped -- that is how a re-run pays them twice. The cost of the choice is real and is the reviewer's
   point: one blocklisted address anywhere in a lenient batch fails all of it. The page's own test run finds
   those addresses first, and names them, before anything is signed.
4. **The stipend is bounded, not free.** A caller can choose 100,000 to 5,000,000 gas per transfer, and
   nothing outside that. Unlimited per-transfer gas is strict mode by another name.
5. **`localStorage` is a convenience, never a guarantee.** It is scoped to chain, account, token and standard,
   keyed on parsed values with an occurrence number, backed by a cross-tab lock, and it reconciles unconfirmed
   transactions against the chain before it trusts itself. It still cannot help another browser or device, and
   the page says so.
6. **Delivery is in ascending token id order.** It is much cheaper on lazily-minted collections, and it means a
   partial run favours the wallets holding lower ids. The confirmation says that in those words.

## Hosting and delivery

Worth checking rather than taking on trust, and all of it is observable from outside:

    curl -sI http://rhairdrop.gmgnrepeat.com/     # 301 to https
    curl -sI https://rhairdrop.gmgnrepeat.com/    # HSTS, and the full CSP as a header
    curl -s  https://rhairdrop.gmgnrepeat.com/ | cmp - web/index.html
    curl -s  https://rhairdrop.gmgnrepeat.com/wc.js | sha256sum   # matches web/wc-build/EXPECTED-SHA256

The page's own inline script is named in the policy by SHA-256 hash, so `unsafe-inline` is not granted and a
script injected into the response cannot run even if it reaches the browser. `web/sync.sh` is what updates
that hash after an edit; `deploy/publish.sh` only verifies it, and refuses to publish a page whose policy does
not name exactly one hash, its own. A publisher that edits the file it is about to ship would ship bytes no
commit contains, which is the thing the dirty-tree guard exists to prevent.

The WalletConnect bundle is fetched by the Worker rather than embedded (it is 2 MB), and the Worker refuses to
serve it unless its SHA-256 matches the digest baked in at publish time, which in turn must match
`web/wc-build/EXPECTED-SHA256`. So the signing-page code cannot drift after review without the deployment
failing.

**What this repository cannot prove**, and what a reviewer should ask the operator about rather than infer:
how the Cloudflare, registrar, GitHub and Reown accounts are secured; whether the deployment token is scoped
to Worker scripts alone; whether the registrar has a transfer lock; and whether DNSSEC and CAA are set. Those
are control-plane facts, and client-side hashes cannot protect anyone if the domain or the deploy credential
is taken.

## Independent monitoring

`.github/workflows/integrity.yml` runs four times a day on GitHub's infrastructure, deliberately not on the
one being watched. It needs no secrets. It fetches both live pages and the connector and compares them with
the files in this repository, checks that the connector still matches `web/wc-build/EXPECTED-SHA256`, that
plain HTTP is still refused and HSTS still sent, that the page still names the recorded contract and still has
mainnet disabled, and that code is still deployed at that address. It also checks the responses that went
wrong -- an unknown path, a malformed explorer request -- because a visitor whose first contact with the host
is an error is exactly the visitor who has not been pinned to HTTPS yet. Any drift fails the job.

A monitor inside the Cloudflare account tells you nothing about the case where that account is the problem,
which is the case worth monitoring for.

## Previous review

- Six internal review passes.
- The integrity workflow watches the live pages against this repository four times a day. **GitHub disables
  scheduled workflows in a public repository after 60 days with no repository activity**, and the quiet
  stretch is the one worth monitoring, so a green badge on a dormant repository means the last run that
  happened rather than the state today. A failure also opens an issue, so it is visible without access to
  anyone's inbox.
- Thirteen adversarial review rounds, each by a fresh model with no prior context, all published unedited in
  [`docs/`](.). Blocking findings by round: 15, 11, 5, 9, 9, 4, 6, 3, 4, 3, 5, 1, 2. Every blocking finding
  is fixed, and every should-fix from the last three rounds is closed or declined with its reason written
  down. The inherent-limit lists are not a backlog: those are the things a browser page cannot prove, written
  down so nobody has to rediscover them.
- Six times, a fix from one round has been the next round's finding. In the tenth it was every blocker. In
  the twelfth the only blocker was round eleven's B-4 surviving on the reader nobody re-checked. In the
  thirteenth the contract blocker was round twelve's own new guard, and six of its nine findings were one
  reader being taught something its twin was not. [`readers.md`](readers.md) exists because of that: every
  reader of each shared input, listed, and a commit that fixes one names the others.
- **The contract is no longer the settled part of this repository.** It was clean and unchanged for seven
  rounds; round eleven found two real findings in it, round twelve three more, and round thirteen found that
  round twelve's guard was not the mirror it claimed to be. The source is now **v13**; the chain still runs
  v12 until v13 is deployed, and v13 has been through every mechanical check here -- 100% branch coverage,
  invariants over random sequences, Slither, a fork suite against 20 real mainnet collections and 20 real
  tokens -- and through no reviewer. **The unreviewed thing in this repository is always whatever was written
  last**, and right now that is the contract.
- Three times before that, a fix from one round has been the next round's finding. That is the most useful thing this
  history shows, and it is why recently changed code is listed first in the review scope rather than last.
- No human audit firm has looked at this.
