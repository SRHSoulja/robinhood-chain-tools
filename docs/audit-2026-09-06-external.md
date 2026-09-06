# Independent security and quality audit: rh-airdrop

> **Status: every finding in this report is fixed.** It is published unedited, including the parts that are
> unflattering, because an audit nobody can read is not evidence of anything. The auditor was given the code
> and the live page and no other context, and was told to try to break it.
>
> What changed in response is listed in [CHANGELOG.md](CHANGELOG.md) under v6 and v7, and each fix is pinned
> by a test that names its finding. The audited contract was v5 at `0x752960A5…fb3DF`; the current one is v7
> at `0xC6AE3189eDAE544Ed60ADf5Ec057E338ce224F74`. One finding, H-01, was a bug I had previously looked at
> and dismissed in a code comment as deliberate. It was not deliberate, it was a double-payment path, and
> that is the single most useful thing this audit did.

---

Date: 2026-09-06  
Target commit: `da78b39` on `master`  
Scope: this repository, deployed testnet `BulkSend` at `0x752960A560EA676BEc736f55D98773eb0e1fb3DF`, and `https://rhairdrop.gmgnrepeat.com`

## Executive summary

I found no Critical issue, but I found eight High-severity failures, four Medium-severity failures, and three Low-severity issues. The contract's lack of ownership and persistent state is a sound design choice for its transfer model: an unrelated caller cannot spend another user's approval because every transfer uses the current `msg.sender` as `from`. That conclusion does not make the product safe. Lenient ERC-20 handling can label an already-executed transfer as skipped and actively invite a duplicate payment. The wallet path can label a false-returning ERC-20 transfer as delivered even when nothing moved. The UI's advertised strict mode is neither run-wide atomic nor even honored on the wallet path. CSV parsing can silently change quantities. There are also concrete double-send and wrong-retry paths in receipt reconciliation and transaction replacement handling.

The 63 repository tests all pass, but several tests assert the contract's counters without asserting the resulting balances. In particular, the malformed-return ERC-20 test encodes the dangerous behavior rather than detecting it.

## Verification performed

The labels below distinguish executed verification from source-based inference.

- **Verified by execution:** `forge build` succeeded and `forge test -vv` passed 63 of 63 tests.
- **Verified by execution:** a scratch Foundry test using the unmodified local `BulkSend` proved that a token can move 10 units, return `false`, and produce `(sent=0, skipped=1)`. A second scratch test proved that a standard true-returning ERC-20 can be sent to `BulkSend` through `airdrop20`, leaving the tokens permanently held there.
- **Verified by read-only RPC:** testnet chain ID is 46630, `LENIENT_GAS()` is 400,000, and the SHA-256 of the deployed runtime bytecode exactly matched `out/BulkSend.sol/BulkSend.json` (`65dc3c115862fabc83e489824e85872136d5e0e7b24016dc6dd124595d1ef25e`). The explorer reports the contract as verified, optimized with 10,000 runs, and compiled with Solidity 0.8.36.
- **Verified by read-only RPC:** `airdrop20(..., amount=[0], lenient=true)` against the deployed OpenZeppelin token returned `(1, 0)` in `eth_call`.
- **Verified against the live page with Playwright:** the quantity-only CSV path converted quantities `0`, `garbage`, and `-3` to one NFT; converted `1.9` to `x1`, `2.9` to `x2`, and retained `x1001` before the later silent cap.
- **Verified against the live page with Playwright:** a legal quoted CSV row `address,note,quantity` plus `recipient,"VIP,2",10` was rewritten as `recipient x2`, not `recipient x10`.
- **Verified against the live page with Playwright:** an ERC-1155 amount of zero was accepted as one valid recipient with no problem shown.
- **Verified against the live page with Playwright:** a mocked holder API with a next page after page 40 caused exactly 40 requests, then the UI reported a complete-looking `40 holders loaded` result without an incompleteness warning.
- **Verified against the live page with Playwright:** a wallet-path ERC-20 `eth_call` that returned the ABI word `false` was reported as `1 of 1 would be delivered`.
- **Verified against the live page with Playwright:** with strict mode selected, two NFT rows, and one simulated failure, the page submitted a `wallet_sendCalls` request containing only the good row and reported `Finished. 1 delivered, 1 left out`.
- **Verified against the live page with Playwright:** after two EIP-6963 wallets announced, the wallet chooser contained those two wallets but no Phone wallet button.
- **Verified by artifact comparison:** the live inline application script and `web/index.html` inline script had the same length and SHA-256. The live `/wc.js` and repository `web/wc.js` both hashed to `050632a7350b82f6c490631bfd4b167176eac36da3d38ec3cc7c6465e9a9c6b8`.
- **Not performed:** no mainnet or testnet transaction was sent. The prohibited `~/.config/rh-airdrop/deployer.json` file was not accessed.

## Findings

### H-01 -- High -- Lenient ERC-20 can transfer funds and report the transfer as skipped

**Location:** `src/BulkSend.sol:149-168`; relevant incomplete test at `test/BulkSendReal.t.sol:260-275`

**Status:** Verified by scratch Foundry execution against the exact local contract.

**Failure scenario:** Use an ERC-20 whose `transferFrom(Alice, Bob, 10)` updates balances and then returns `false`, a 16-byte value, or a 32-byte word other than one. The low-level EVM call succeeds, so the token's state change persists. At line 157, `good` becomes false. In lenient mode, lines 160-162 increment `skipped` and emit `Skipped` without reverting the subcall. Bob has 10 tokens, but the page records no delivery, exports Bob in `skipped.csv`, and tells Alice to retry. Retrying pays Bob twice.

This is not theoretical inside the test suite. `Weird20.transferFrom` moves balances before returning malformed data, while `testWeird20_odd_return_data_is_a_failure_not_a_panic` checks only counters and never checks recipient balances.

**Fix:** In lenient mode, only a reverted low-level call is safe to skip. If `ok == true` and non-empty return data is anything other than exactly ABI `true`, revert the entire transaction with a new `AmbiguousERC20Result` error. That rolls back any hidden state change. Accept empty return data for known no-return compatibility and accept exactly 32-byte true. Add balance assertions to the malformed and false-return tests.

### H-02 -- High -- Wallet delivery treats ERC-20 `false` as success and records an unpaid recipient as delivered

**Location:** `web/index.html:162-167`, `web/index.html:839-860`, `web/index.html:997-1020`

**Status:** Verified on the live page with a mocked EIP-5792 wallet and RPC.

**Failure scenario:** A wallet reports atomic batching support. The selected ERC-20 has enough sender balance but returns `false` from `transfer(Bob, 100)` for a blacklisted Bob without reverting. `rp.call` resolves normally with 32 zero bytes, so line 846 adds Bob to `good`. The actual wallet call also succeeds at the EVM call level; raw wallet batching has no ABI-level requirement to interpret the token's boolean. The batch receipt is successful, and line 1019 records Bob as delivered even though Bob received zero.

The live-page reproduction returned ABI `false` from the transfer simulation. The UI printed `Test run finished: 1 of 1 would be delivered.`

**Fix:** Do not route ERC-20 through raw `wallet_sendCalls`. Use `BulkSend`, whose code can check return data, even when the wallet advertises batching. If the no-approval property is mandatory, the wallet must execute return-aware batch code and expose trustworthy per-call results; raw token calls cannot provide that guarantee. At minimum, decode ERC-20 simulation returndata and reject false or malformed results, but that alone remains vulnerable to state changes after simulation.

### H-03 -- High -- “All or nothing” is false across chunks and is ignored entirely on the wallet path

**Location:** `web/index.html:85`, `web/index.html:832-860`, `web/index.html:942-978`, `web/index.html:984-1026`

**Status:** Wallet behavior verified by live-page Playwright mock; multi-transaction behavior verified from control flow.

**Failure scenario A:** Select strict mode, use a wallet with EIP-5792 support, and provide Alice/id 1 (valid) and Bob/id 2 (recipient rejects). The test run removes Bob and sends only Alice. I executed this exact case: `wallet_sendCalls` contained one call, and the page finished with one delivered and one left out despite strict mode.

**Failure scenario B:** Use the BulkSend path with 101 recipients and batch size 100. The first transaction delivers recipients 1-100. Recipient 101 fails in the second transaction. Strict contract mode reverts only transaction two; the first 100 transfers remain. The UI promised that if any wallet fails, nothing is sent.

**Fix:** Define strict mode as run-wide atomic and enforce what is technically possible. On the wallet path, any failed preflight row must make the run non-sendable. On the BulkSend path, strict mode must use exactly one transaction; if the full list cannot fit, refuse strict mode rather than chunk it. Otherwise rename the choice to `All or nothing within each transaction` and explicitly show that earlier chunks remain final.

### H-04 -- High -- CSV parsing and quantity inference silently alter allocations

**Location:** `web/index.html:391-460`, `web/index.html:636-675`

**Status:** Verified on the live page with concrete CSV inputs.

**Failure scenario A:** Upload:

```csv
address,note,quantity
0x0000000000000000000000000000000000000014,"VIP,2",10
```

Quoted commas are valid CSV. `splitRow` is delimiter-based rather than CSV-aware, so the quoted note becomes two cells and shifts the named quantity column. The page rewrote this row as `x2`, silently changing the intended ten NFTs to two.

**Failure scenario B:** For an ERC-721 quantity-only named file, quantities `0`, `garbage`, blank, or negative all become the absence of an `xN` suffix and are later treated as one. Decimals are truncated with `parseInt`; `2.9` becomes two. Values above 1,000 are later capped without requiring acknowledgment. These are silent asset-allocation changes, not parse failures.

**Fix:** Replace `splitRow` with an RFC 4180 parser. Reject extra/unconsumed cells. Validate quantity as a canonical positive integer in an explicit supported range before rewriting anything. Never default an invalid supplied quantity to one. Treat `quantity with no tokenId` as an import mode that requires an explicit user confirmation and a rendered allocation preview before `Assign` can overwrite the source list.

### H-05 -- High -- ERC-1155 skipped-event reconciliation can export the successful row and remember the failed row

**Location:** `web/index.html:958-975`, `web/index.html:1052-1056`

**Status:** Verified by executing the exact matching predicate with concrete event and row objects; the token behavior is inferred from standard sequential transfer behavior.

**Failure scenario:** The chunk contains the same recipient and ID twice: `(Bob, id 7, amount 3)` then `(Bob, id 7, amount 4)`. The sender holds five. In lenient mode, amount 3 succeeds and amount 4 fails. The `Skipped` event includes amount 4. The matching predicate checks amount only for ERC-20; for ERC-1155 it checks recipient and ID, so it selects the first row, amount 3, as the failure. The app exports amount 3 for retry and stores amount 4 as delivered. The executed predicate produced exactly `matchedAsFailedIndex: 0`, `exportedForRetry: 3`, and `markedDelivered: [4]`. Retrying pays another three while the intended four remains unpaid.

**Fix:** Match every event on the full tuple `(token, recipient, id, amount)` and consume one occurrence at a time. Do not use the address-only fallback. Before writing local state, require `matched skipped rows == Skipped event count` and `matched delivered rows == aggregate sent`; if reconciliation is ambiguous, persist the transaction as unresolved and require receipt review.

### H-06 -- High -- A successful sped-up replacement transaction is treated as failure and is not recorded

**Location:** `web/index.html:946-981`

**Status:** Inferred from source and the documented ethers v6 error contract.

**Failure scenario:** A user submits an ERC-20 batch, then presses `Speed up` in MetaMask or another wallet. The replacement has the same calldata and succeeds. Ethers rejects the original `tx.wait()` with `TRANSACTION_REPLACED` and includes the replacement receipt. The generic catch at line 981 only logs an error; it neither processes the successful replacement receipt nor marks deliveries. The next run sees every row as fresh and can pay all recipients again.

Ethers documents the replacement error and its `cancelled`, `replacement`, and `receipt` fields in its [v6 error documentation](https://docs.ethers.org/v6/single-page/#api_utils_errors__TransactionReplacedError).

**Fix:** Centralize receipt processing. Catch `TRANSACTION_REPLACED`; if `cancelled == false` and the replacement receipt succeeded, process that receipt exactly as the original. If cancellation or replacement intent is ambiguous, save a durable pending record and block resend until the replacement hash is reconciled.

### H-07 -- High -- `BulkSend holds nothing` is false, and the UI permits permanent self-sinks

**Location:** `src/BulkSend.sol:63-95`, `src/BulkSend.sol:135-172`, `web/index.html:87`, `web/index.html:108-111`

**Status:** Verified by scratch Foundry execution for ERC-20; ERC-721 behavior follows the standard unsafe `transferFrom` path.

**Failure scenario:** Put `0x752960A560EA676BEc736f55D98773eb0e1fb3DF` itself in the recipient list. An ERC-20 transfer succeeds and leaves tokens at BulkSend. An ERC-721 with `safe` unchecked uses `transferFrom` and can likewise become owned by BulkSend. There is no owner and no rescue function, so those assets are unrecoverable. The page's default has safe mode unchecked and repeatedly asserts that BulkSend holds nothing.

**Fix:** Reject `dst == address(this)` in all three contract methods, in both modes. Reject the deployed BulkSend address in the client before parsing completes. Default ERC-721 to safe transfer; put unsafe transfer behind an expert acknowledgment that states contract recipients may permanently trap NFTs. Keep the contract ownerless; adding a privileged rescue role would enlarge the trust surface and is not the right repair for an avoidable self-destination.

### H-08 -- High for mainnet release -- Changing networks retains parsed rows and token interpretation

**Location:** `web/index.html:349-355`, `web/index.html:728-755`

**Status:** Source-verified latent defect. The mainnet option is currently disabled, so the normal live UI cannot trigger it today.

**Failure scenario:** After mainnet is enabled, parse `1.0` units for a six-decimal token on testnet, producing the integer 1,000,000. Change to mainnet, where the same address is an 18-decimal token. The network handler clears `tokenLoadedFor` and validator state but does not clear `rows`, `decimals`, the displayed token metadata, or rerun `tokenInfo`. `plan()` does not require `tokenLoadedFor` to match. Send remains based on the old integer and can deliver `0.000000000001` mainnet tokens instead of one. For NFTs, the retained IDs can refer to an entirely different collection deployed at the same address.

**Fix:** On network change, clear `rows`, `decimals`, `tokenLoadedFor`, `gatedBy`, `tokenPaused`, parse status, and delivery status; then rerun token discovery for the selected chain. Gate every send on `(tokenLoadedFor == normalized current address && tokenLoadedChain == selected chain)`.

### M-01 -- Medium -- localStorage is a best-effort cache, not double-send protection

**Location:** `web/index.html:527-547`, `web/index.html:700-704`, `web/index.html:108-110`

**Status:** Source-verified.

**Failure scenario:** Open the same campaign in two tabs. Both call `workingList()` before either receipt is recorded, both see the recipient as fresh, and both submit it. The per-tab `sending` flag does not coordinate tabs. The same failure occurs across devices, browsers, private windows, cleared site data, or origin changes. After 20,000 unique row keys, the explicit `.slice(-20000)` discards older protection. Conversely, an intentional later campaign sending the same amount to the same wallet is blocked until the user clears the entire token/account history.

The key shape also has no campaign identity or occurrence number. `(recipient, id, amount)` is a transfer identity, not a distribution-run identity.

**Fix:** Stop claiming that reload protection prevents double payment. Create an explicit campaign ID and immutable manifest hash. Persist rows with occurrence numbers and states such as `planned`, `submitted`, `confirmed`, `skipped`, and `ambiguous`, plus transaction hashes. Acquire a cross-tab Web Lock and broadcast pending changes. Reconcile pending hashes from chain receipts on load. Cross-device safety requires an exported/imported signed manifest or a server/on-chain campaign ledger; localStorage alone cannot provide it.

### M-02 -- Medium -- The “whole run” simulation is not a sequential simulation and happens after confirmation

**Location:** `web/index.html:797-875`, `web/index.html:911-937`

**Status:** Source-verified; the ERC-20 false-return and strict filtering subcases were separately verified by Playwright.

**Failure scenario:** A token has 150 units of a daily transfer quota left. The airdrop has two chunks of 100. Each BulkSend `staticCall` runs against the same pre-run state, so both independently pass. The first real transaction consumes 100 quota; the second fails. The wallet path is weaker: each transfer is simulated independently instead of simulating the atomic sequence, so cooldowns, receiver state, cumulative fees, or per-block limits can also make the real batch differ.

The confirmation dialog is shown before the automatic preflight. If that preflight removes recipients on the wallet path, the page sends the smaller list without a second confirmation. `list` equality is therefore not equivalent to execution equality, and the claim that the test tells the user exactly how many will be delivered is too strong.

**Fix:** Run the final preflight first, create a frozen manifest, and only then show the confirmation with the exact included/excluded rows, ordering, chunk boundaries, token address, amounts, and IDs. For stateful multi-transaction runs, either use sequential state simulation through a supported trace/state-override service or state plainly that later chunks can diverge. Recheck basic balances and ownership immediately before every chunk.

### M-03 -- Medium -- Holder “snapshot” silently truncates and is not point-in-time consistent

**Location:** `web/index.html:549-590`

**Status:** Silent 40-page cutoff verified on the live page with mocked explorer responses; cross-page inconsistency inferred from the unpinned API requests.

**Failure scenario:** A collection has more than 40 API pages. The loop stops at page 40 even when `next_page_params` exists. The only incomplete-list warning is tied to `holders.length >= 5000`, so normal 50-item pages stop at 2,000 with no warning. I verified the same logic with one item per page: page 40 still returned a next-page cursor, but the page said only `40 holders loaded` and did not say the result was incomplete.

The requests are also not pinned to one block. If X transfers to Y while pages are being fetched, pagination can include both or neither depending on index changes, then the tool sends assets based on a list that was never a snapshot.

**Fix:** Continue until no next-page cursor, subject to an explicit user-approved cap. If capped, fail closed and refuse assignment rather than merely warn. Record and display an immutable block number, and derive/verify holders at that block. Include the block, source, fetched count, and completeness status in an exportable manifest.

### M-04 -- Medium -- Zero-value rows are counted and remembered as deliveries

**Location:** `src/BulkSend.sol:97-128`, `src/BulkSend.sol:135-171`, `web/index.html:450-456`, `web/index.html:496-500`

**Status:** Verified in the live parser and with a read-only call to the deployed contract.

**Failure scenario:** Import `(Bob, ERC-1155 id 42, amount 0)` or `(Bob, ERC-20 amount 0)`. The parser accepts the row. A permissive token returns success, BulkSend increments `sent`, and the client records the row as delivered even though Bob received no value. The deployed testnet contract returned `(1, 0)` for a zero-amount OpenZeppelin ERC-20 call.

**Fix:** Reject zero amounts in the client and contract with `ZeroAmount(index)`. Do not count a no-op as sent.

### L-01 -- Low -- Multiple injected wallets remove the WalletConnect route and providers are keyed by non-unique RDNS

**Location:** `web/index.html:46`, `web/index.html:203-224`

**Status:** Verified on the live page.

**Failure scenario:** Two extensions announce through EIP-6963. `renderWalletChoice()` clears `walletBox` and creates only extension buttons, deleting `Phone wallet`. A user with MetaMask and Rabby installed can no longer choose Robinhood Wallet by WalletConnect without disabling an extension. Separately, using `rdns` as the map key lets two provider announcements with the same RDNS replace one another; EIP-6963 provides `uuid` for provider identity.

**Fix:** Preserve a WalletConnect button in every chooser state. Key announcements by `info.uuid`, store the selected UUID plus RDNS for display, and provide a visible disconnect/change-wallet action.

### L-02 -- Low -- Fixed lenient gas is a policy threshold, and strict revert data is unnecessarily corrupted

**Location:** `src/BulkSend.sol:46-61`, `src/BulkSend.sol:174-205`

**Status:** Source-verified and covered by repository tests.

**Failure scenario:** A legitimate receiver performs more than 400,000 gas of initialization. Lenient mode reports it as skipped even though strict mode succeeds; the repository's `HeavyAccepts` test demonstrates exactly this. No universal constant separates honest from hostile receivers. Also, `_callAll` caps strict ERC-20 revert data at 128 bytes and line 165 reverts with that truncated buffer. A long `Error(string)` becomes invalid ABI, contradicting the promise that strict mode bubbles the token's own error.

The gas cap itself is the correct kind of liveness mechanism for lenient mode. Forwarding all remaining gas would let one recipient starve the loop. The problem is presenting 400,000 as a correctness boundary rather than a chosen tradeoff.

**Fix:** Let callers choose a bounded per-call stipend and reserve enough gas for loop bookkeeping, the failure event, and remaining iterations. Surface `empty reason under gas cap` as `failed or exceeded stipend`, not `cannot receive`. Keep the 128-byte cap in lenient mode. In strict mode, bubble full revert data or deliberately replace it with a structured hash/length error rather than malformed truncation.

### L-03 -- Low -- Ascending delivery changes which random recipients are favored by a partial run

**Location:** `web/index.html:66`, `web/index.html:657-674`, `web/index.html:777-787`, `web/index.html:938`

**Status:** Source-verified.

**Failure scenario:** Random pairing assigns IDs fairly, but delivery is then sorted by ID before chunking. If the user stops after the first batch, rejects a later prompt, or a later transaction fails, recipients paired with the lowest IDs are the delivered subset. If rarity or value correlates with ID ranges, partial completion has a material selection rule that the confirmation dialog does not show. The sorting disclosure is logged only after confirmation. On-chain calldata already reveals the full pairing, so ascending order does not create an additional secrecy leak; it changes partial-run semantics.

**Fix:** Show the final ordered manifest and chunk boundaries before confirmation. State that partial completion favors lower IDs. If fair partial completion matters more than ERC721A gas, randomize chunk membership and sort only within each chunk, then quantify the gas tradeoff.

## Areas where I found no issue

- **Access control and approval theft:** I found no path for an arbitrary third party to spend another user's ERC-20 allowance or NFT operator approval through BulkSend. Every transfer uses the immediate caller as `from`; the contract has no owner, delegatecall, upgrade, arbitrary-call function, or stored authority.
- **Reentrancy:** I found no caller-fund theft or state corruption through reentrancy. The contract has no mutable state, and a reentrant recipient becomes the caller of the nested batch, so it can only attempt to move its own assets and approvals. Event order can be nested, but the web app parses only the receipt and only logs emitted by the fixed BulkSend address.
- **Length and empty-list validation:** The three contract entry points correctly reject mismatched arrays and empty batches.
- **Zero-address recipient policy:** Reverting in strict mode and explicitly skipping in lenient mode is a defensible and safe choice. It prevents accidental burns, including on permissive tokens. The client rejects zero-address rows before sending. I would keep this policy.
- **EIP-7702 token-address guard:** The 23-byte `0xef0100 || address` detection is correct for the current delegation designator and is covered by a passing test. I found no bypass for a normal delegated EOA under the current EIP-7702 format.
- **EIP-5792 request/status shape:** The app uses version `2.0.0`, a no-leading-zero hexadecimal chain ID, top-level `atomicRequired: true`, and fails closed on failed, partial, missing-receipt, unknown, or timed-out status. Those choices match the current [EIP-5792 specification](https://eips.ethereum.org/EIPS/eip-5792). The problems are in which calls the app submits and how it validates token-level success, not the basic RPC shape.
- **Common wallet failure paths:** Before each batch, the app rechecks the selected chain. It locks form controls during send, stops after an ordinary rejected prompt, does not mark unknown or partial EIP-5792 results as delivered, and does not mark a timed-out multisig request as delivered. Those are appropriate fail-closed choices. The replacement-transaction and cross-tab gaps above remain. I found no hardware-wallet-specific operation beyond the wallet's normal transaction prompts.
- **Proof contracts are off-path:** Repository-wide references to `SelfBatch` and `Batch7702` occur only in their own source files. The live page sends raw token calls through the wallet's own EIP-5792 implementation and does not reference or deploy either proof contract.
- **Return-bomb defense in lenient mode:** Copying at most 128 bytes prevents malicious revert data from becoming an unbounded memory amplifier. The repository includes a meaningful 200 KB return-bomb test.
- **Random pairing primitive:** `crypto.getRandomValues` is appropriate. The modulo reduction has negligible bias at these list sizes. Pairing remains fixed when the list is later sorted by token ID.
- **DOM injection:** Untrusted token names, symbols, revert messages, and log strings are written through `textContent`. I found no direct DOM-XSS sink in the application code. The externally loaded ethers script is version-pinned and protected by SRI.
- **Current mainnet lockout:** Mainnet is disabled both in the select element and through `LIVE_CHAINS`; changing the DOM selection alone does not make delivery live.
- **Deployment correspondence:** The live application logic, live WalletConnect bundle, verified explorer source, deployed runtime bytecode, and repository artifacts correspond at the time of this audit.

## Decision assessment

- **Stateless and ownerless:** Right as the base architecture. Do not add an admin or rescue role. Reject self-destinations and stop claiming the address can never hold assets.
- **400,000 gas and 128-byte lenient reason cap:** A cap is necessary for lenient liveness, but 400,000 is not a universal correctness threshold. Make the stipend a bounded caller choice and describe failures as ambiguous. The 128-byte cap is sound for lenient events; it should not be used to produce malformed strict-mode revert data.
- **Zero address:** The strict-revert/lenient-skip split is appropriate. It is safer than attempting a token-dependent burn.
- **localStorage key shape:** `(chain, account, token, standard, recipient, id, amount)` describes an asset transfer, not a campaign or an occurrence. It breaks on repeated legitimate campaigns, duplicate identical rows, multiple tabs/devices, replacements, pending transactions, storage clearing, and the 20,000-entry truncation. It cannot support the guarantee made in the footer.
- **Dropping failed recipients after test run:** Wrong without a post-test manifest confirmation, and flatly incompatible with strict mode. A simulation result is not authorization to change the signed distribution.
- **Quantity-only NFT inference:** Unsafe as an automatic rewrite. It needs strict validation and explicit confirmation.
- **Random pairing plus ascending delivery:** It does not change the chosen recipient-ID mapping or add an on-chain secrecy leak, but it defines who receives first in a partial run. That ordering must be visible before confirmation.

## Verdict

This is **not safe to put in front of the public on mainnet in its current form**. Mandatory before mainnet: fix lenient ERC-20 ambiguous returndata so a moved transfer can never be labeled skipped; disable the raw wallet path for ERC-20 or make it return-aware; make strict mode truthful and enforceable; replace the CSV parser and reject invalid/zero quantities; reconcile skipped ERC-1155 rows on the full tuple; handle successful transaction replacements; reject BulkSend as a recipient and default ERC-721 to safe transfer; reset all parsed state on network changes; and move the final frozen-manifest confirmation after preflight. localStorage must be demoted from a safety guarantee to a recoverable campaign ledger with pending transaction reconciliation. The contract's minimal authority model is good, but the delivery client currently creates both double-payment and silent-underpayment paths around it.
