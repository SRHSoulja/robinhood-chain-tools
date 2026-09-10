# What this is for, and how anyone would know it is finished

Written down because a findings list always has a next item, and that is a bad way to decide what to build.

## Who it is for

People on Robinhood Chain who want to send tokens to a lot of wallets at once — an airdrop, a snapshot
reward, a distribution to holders — and who are not developers.

## The gap it fills

When this started there was a bulk sender for **ERC-20 on this chain and nothing else**. Anyone with an NFT
collection or a set of ERC-1155 editions had no tool at all, which in practice means sending them one at a
time or trusting something written for another chain.

So the point of this project is **all three standards, to the same standard**: ERC-721, ERC-1155 and ERC-20,
each one as reliable and as carefully checked as the others. An ERC-1155 airdrop is not a secondary feature
here. It is half of why the tool exists.

That has a direct consequence for how work is prioritised: a promise proven for ERC-721 and assumed for the
other two is a promise half kept. Wherever this file lists evidence, it lists it per standard.

## What "safe and reliable" has to mean, in terms that can be checked

Vague goals cannot be tested, so these are the promises, and every one of them is something a stranger can
verify rather than take on trust. [`status.md`](status.md) records which are currently proven and how.

1. **Nobody is paid twice.** Not across reloads, crashes, closed tabs, replaced transactions or two tabs at
   once. Where the page cannot know, it holds the row back rather than sending again.
2. **Nobody is silently missed.** A recipient is never dropped to make a list fit or a batch succeed. What
   was parsed is what is sent, in full, or the page says why not.
3. **The list is delivered as written.** No silent rounding, re-scaling, or reordering that changes who gets
   what. Ordering may change for cost; the pairing may not.
4. **It never claims to know more than it does.** A count is not a receipt, a wallet's word is not the chain,
   and an unreadable answer is reported as unreadable rather than resolved into a guess. This is the promise
   most of the review findings have been about, and the one that is easiest to break by accident.
5. **The sender keeps control.** No owner, no upgrade path, no fee, and nothing that can move a token the
   sender did not approve inside the transaction they signed.
6. **Everything it says about itself is checkable.** Deployed bytecode against this source, live pages against
   these files, gas figures against measurements anyone can repeat, reviews published unedited including the
   unflattering parts.

## What it deliberately does not do

- It does not try to tell a real token from a contract impersonating one. That cannot be settled on chain, it
  is stated plainly rather than papered over, and it is why the page asks the chain who holds what afterwards
  instead of believing a counter.
- It does not custody anything, take a fee, or keep a record anywhere but the sender's own browser and the
  chain.
- It is not a wallet, a marketplace, or a portfolio tool.

## How anyone would know it is finished

Finished, for the first release, means all of these at once:

- [ ] every promise above proven **for all three standards**, live on chain, not only against mocks
- [ ] a review round that finds no release blockers
- [ ] explicit permission from the maintainer, given after that round
- [ ] `docs/status.md` accurate on the day it is read, with nothing marked closed that has not been
      demonstrated closed

Three of those are objective. The fourth is the one that has actually gone wrong: a finding has been marked
closed here that had not been touched. Treat a claim in the status file with the same suspicion as a claim in
the code, and check it the same way.

Not finished does not mean not useful. It means testnet.
