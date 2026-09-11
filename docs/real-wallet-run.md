# Gate 10: one real-wallet airdrop on the final testnet page

Every wallet in every automated test here is written by this repository. The four live scripts prove the
contract, the page and the chain agree, but the wallet in them is a test implementation. This gate is one
airdrop of each kind driven by a real wallet, on testnet, against the published page, read back from the
explorer. It spends testnet gas only. It is done by the maintainer, because it needs their phone and browser.

## Before

1. Testnet ETH in the wallet you will use: https://faucet.testnet.chain.robinhood.com/ (browser only).
2. Fixtures minted to that wallet. From this repository, with the wallet's address:

       ./deploy/mint-fixtures.sh 0xYourWalletAddress

   It mints 6 fresh ERC-721 ids in `OZ721`, 10 units of one fresh ERC-1155 edition in `OZ1155`, and 30 `OZ20`
   tokens, all in an id decade no live script uses, and prints the ids. Nothing already in that wallet is
   touched.
3. The page: https://rhairdrop.gmgnrepeat.com/ on Robinhood Chain Testnet (the page offers to add it).

## The runs

Do each of the three with an **injected browser wallet** (MetaMask or equivalent), then repeat the ERC-721 one
from a **phone over WalletConnect** (scan the code, sign on the phone, and background the tab while the wallet
is open: that is the case round thirteen's B-2 was about).

| standard | list | expect |
| --- | --- | --- |
| ERC-721 | three fresh addresses, one minted id each | approve once, then one transaction; three `Transfer`s in the explorer |
| ERC-1155 | three fresh addresses, id printed by the script, 2 each | one transaction; three `TransferSingle`s |
| ERC-20 | three fresh addresses, 1.5 each | approve, then one transaction; three `Transfer`s of 1.5 |

Fresh addresses: any three you make up, e.g. `0x51e0000000000000000000000000000000000d01`, `…d02`, `…d03`.

For each run, keep: the transaction hash the page shows, what the page said at the end ("done: 3 arrived"),
and anything that surprised you. Then read each hash back on the explorer, not on the page:
`https://explorer.testnet.chain.robinhood.com/tx/<hash>`. The decoded input must name the function you
expected, the status must be success, and the logs must be the events in the table.

## What counts as passing

All four runs land, the explorer agrees with the page on every hash, and nothing the page said turned out to
be false. Anything else is a finding: write it down with the hash and it goes into the next round.

## Why this is a gate and not a test

It cannot be automated honestly. A wallet extension and a phone wallet are what real users have, and no
mock written here can tell you what they do. The maintainer drove the page from a phone once before, against
a contract five versions ago; this repeats it against the page and contract that would go to mainnet.
