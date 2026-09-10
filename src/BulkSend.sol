// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BulkSend — batch airdrops of ERC-721, ERC-1155 and ERC-20 on Robinhood Chain
/// @notice Holds nothing. Every transfer is `transferFrom(msg.sender, ...)`, so the contract can only
///         move what the caller approved, inside the transaction the caller signed. No owner, no
///         upgrade path, no fees, no pause. If you want it to stop, stop calling it.
///
/// Two modes:
///  - strict  (`lenient = false`): the token's own revert bubbles up and the whole batch reverts. Full gas
///            is forwarded to each transfer, so a recipient with a heavy receive hook still works here.
///  - lenient (`lenient = true`): a recipient that cannot receive is skipped, logged with `Skipped`, and the
///            rest is delivered. Each transfer gets at most the stipend, so one recipient that burns gas
///            cannot starve the batch, and at most `REASON_CAP` bytes of its revert data are kept, so one
///            recipient returning megabytes cannot inflate the batch's memory cost.
///
/// The stipend is a policy choice, not a law of nature: no constant separates an honest receiver from a
/// hostile one. `DEFAULT_GAS` is what the plain entry points use; the `…WithGas` entry points let a caller
/// pick their own between `MIN_GAS` and `MAX_GAS`. A recipient skipped for running out of it has not been
/// judged unable to receive; it may simply be expensive. Send that one on its own in strict mode, where the
/// whole transaction's gas is available to it, or raise the stipend.
///
/// What this contract cannot do is make a token honest. Every delivery it counts means "the token's transfer
/// function was called and did not fail". A contract that accepts a transfer, returns success and moves
/// nothing is indistinguishable from one that paid; a fee-on-transfer token delivers less than the amount
/// asked for while correctly returning true. Counting is not proof of payment. The chain is.
interface IERC721Like {
    function transferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IERC1155Like {
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract BulkSend {
    event Airdrop721(address indexed token, address indexed from, uint256 sent, uint256 skipped);
    event Airdrop1155(address indexed token, address indexed from, uint256 sent, uint256 skipped);
    event Airdrop20(address indexed token, address indexed from, uint256 sent, uint256 skipped);
    event Skipped(address indexed token, address indexed to, uint256 id, uint256 amount, bytes reason);

    error LengthMismatch();
    error EmptyBatch();
    error TransferFailed(address to, uint256 id);
    error NotAContract(address token);
    error NotAnNft(address token);
    error IsAnNft(address token);
    error DelegatedWallet(address token);
    error SelfRecipient(uint256 index);
    error ZeroAmount(uint256 index);
    error AmbiguousResult(address to, uint256 index);
    error ZeroRecipient(uint256 index);
    error OutOfGasForBatch(uint256 index);
    error GasOutOfRange(uint256 given, uint256 min, uint256 max);
    error GasIsForLenientOnly();
    error Reentered();

    /// @notice Refuses to run inside itself.
    /// @dev Not to protect this contract's own state, which does not exist. A recipient's receive hook runs
    ///      in the middle of a batch, and a hook that calls back in can emit real `Skipped` and `Airdrop*`
    ///      events from this address, naming whatever row it likes. The client reads the receipt to decide who
    ///      was paid, so a recipient able to write into that receipt can have itself recorded as skipped after
    ///      being paid, and collect again on the retry. The lock costs about 100 gas and is transient: it is
    ///      gone when the transaction ends, so this contract still stores nothing between transactions.
    ///      A recipient whose hook legitimately calls back in is skipped in lenient mode rather than trusted.
    /// keccak256("bulksend.reentrancy.v1") - 1, written out because inline assembly takes only literals.
    uint256 private constant REENTRANCY_SLOT = 0x79981972fbb1dd6496d9a6ffdb7f04a877acc052e10223665ed2fec026626fca;

    modifier nonReentrant() {
        assembly ("memory-safe") {
            if tload(REENTRANCY_SLOT) {
                mstore(0x00, 0xb5dfd9e5)   // Reentered()
                revert(0x1c, 0x04)
            }
            tstore(REENTRANCY_SLOT, 1)
        }
        _;
        assembly ("memory-safe") { tstore(REENTRANCY_SLOT, 0) }
    }

    /// @dev Carried as one memory pointer rather than three stack slots: with two calldata arrays, a mode,
    ///      a safety flag and a stipend, the legacy code generator runs out of stack inside the loop.
    struct Opts { bool safe; bool lenient; uint256 gasPerTransfer; }

    /// @notice Gas given to one transfer (and its recipient's receive hook) in lenient mode, unless the
    ///         caller chooses otherwise through a `…WithGas` entry point.
    /// @dev Without a cap, EIP-150 hands a callee 63/64 of the remaining gas, so one recipient whose hook
    ///      burns everything leaves the loop with 1/64 and the rest of the batch runs dry: exactly what
    ///      lenient mode promises not to do. Measured honest recipients (OpenZeppelin ERC-721/1155, ERC721A
    ///      crossing an uninitialized ownership slot, smart-contract wallets) land well under this.
    uint256 public constant DEFAULT_GAS = 400_000;

    /// @notice The floor and ceiling for a caller-chosen stipend.
    /// @dev The floor is above the cost of an ordinary transfer to a plain wallet, so a mistyped stipend
    ///      cannot turn an entire honest list into "skipped". The ceiling keeps the liveness promise: a
    ///      stipend larger than this leaves too little behind for the rest of a batch to be worth calling
    ///      lenient at all, and a caller who wants unlimited gas per transfer is describing strict mode.
    uint256 public constant MIN_GAS = 100_000;
    uint256 public constant MAX_GAS = 5_000_000;

    /// @notice Gas held back from the stipend check for the rest of one iteration.
    /// @dev The stipend is what the recipient may spend. On top of it this loop still has to copy up to
    ///      `REASON_CAP` bytes of returndata, emit `Skipped`, and reach the next iteration. Reserving that
    ///      separately is why "there is enough gas" means enough for the transfer *and* for recording it.
    uint256 internal constant GAS_RESERVE = 40_000;

    /// @dev Reason emitted when a lenient batch is asked to send to the zero address. The transfer is skipped
    ///      rather than attempted: some tokens treat the zero address as a burn, and burning someone's NFT
    ///      because of a stray line in a spreadsheet is not a recoverable mistake. Strict mode reverts instead.
    /// @dev The reason recorded against a skipped zero-address row. Built per row so it carries the index:
    ///      this used to be a bare constant holding the selector of `AddressZero()`, an error this contract
    ///      does not declare and nothing in the repository could decode.
    function _zeroReason(uint256 i) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ZeroRecipient.selector, i);
    }

    /// @notice Bytes of a failed transfer's revert data kept for the `Skipped` event.
    /// @dev A hostile recipient can revert with megabytes; copying and emitting all of it is a gas amplifier.
    ///      128 bytes holds any custom error with a few arguments and the front of an `Error(string)`.
    uint256 internal constant REASON_CAP = 128;

    /// @notice Kept so anything built against the first release still reads the same name.
    function LENIENT_GAS() external pure returns (uint256) { return DEFAULT_GAS; }

    // ---------------------------------------------------------------- ERC-721

    /// @notice Send one ERC-721 id to each recipient. `safe` uses safeTransferFrom (recipient contracts must accept).
    function airdrop721(address token, address[] calldata to, uint256[] calldata ids, bool safe, bool lenient)
        external
        nonReentrant
        returns (uint256 sent, uint256 skipped)
    {
        return _airdrop721(token, to, ids, Opts(safe, lenient, DEFAULT_GAS));
    }

    /// @notice The same, with your own per-transfer gas stipend. Lenient mode only; `MIN_GAS` to `MAX_GAS`.
    function airdrop721WithGas(
        address token,
        address[] calldata to,
        uint256[] calldata ids,
        bool safe,
        bool lenient,
        uint256 gasPerTransfer
    ) external nonReentrant returns (uint256 sent, uint256 skipped) {
        return _airdrop721(token, to, ids, Opts(safe, lenient, _checkGas(gasPerTransfer, lenient)));
    }

    function _airdrop721(address token, address[] calldata to, uint256[] calldata ids, Opts memory o)
        internal
        returns (uint256 sent, uint256 skipped)
    {
        uint256 n = to.length;
        if (n != ids.length) revert LengthMismatch();
        if (n == 0) revert EmptyBatch();
        _mustBeContract(token);
        _mustBeNft(token, ids[0], ids[n - 1]);
        for (uint256 i; i < n;) {
            address dst = to[i];
            if (dst == address(this)) revert SelfRecipient(i);   // nothing here can ever give it back
            if (o.lenient) {
                if (dst == address(0)) { ++skipped; emit Skipped(token, dst, ids[i], 1, _zeroReason(i)); unchecked { ++i; } continue; }
                (bool ok, bytes memory reason) = _tryCall(
                    token,
                    o.safe
                        ? abi.encodeCall(IERC721Like.safeTransferFrom, (msg.sender, dst, ids[i]))
                        : abi.encodeCall(IERC721Like.transferFrom, (msg.sender, dst, ids[i])),
                    i,
                    o.gasPerTransfer
                );
                if (ok) {
                    // A conforming ERC-721 returns nothing. Anything that answers is not the function we
                    // called, and counting it as delivered is recording a payment that may not have happened.
                    if (reason.length != 0) revert AmbiguousResult(dst, i);
                    ++sent;
                } else {
                    ++skipped;
                    emit Skipped(token, dst, ids[i], 1, reason);
                }
            } else {
                if (dst == address(0)) revert ZeroRecipient(i);
                if (o.safe) IERC721Like(token).safeTransferFrom(msg.sender, dst, ids[i]);
                else IERC721Like(token).transferFrom(msg.sender, dst, ids[i]);
                // A high-level call to a void function ignores whatever comes back, so strict mode counted a
                // token that answered as a delivery just as lenient mode did.
                uint256 rds;
                assembly ("memory-safe") { rds := returndatasize() }
                if (rds != 0) revert AmbiguousResult(dst, i);
            }
            unchecked { ++i; }
        }
        if (!o.lenient) sent = n;   // strict mode delivers every entry or reverts, so counting in the loop is wasted gas
        emit Airdrop721(token, msg.sender, sent, skipped);
    }

    // --------------------------------------------------------------- ERC-1155

    /// @notice Send `amounts[i]` of ERC-1155 `ids[i]` to each recipient.
    function airdrop1155(
        address token,
        address[] calldata to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bool lenient
    ) external nonReentrant returns (uint256 sent, uint256 skipped) {
        return _airdrop1155(token, to, ids, amounts, Opts(false, lenient, DEFAULT_GAS));
    }

    /// @notice The same, with your own per-transfer gas stipend. Lenient mode only; `MIN_GAS` to `MAX_GAS`.
    function airdrop1155WithGas(
        address token,
        address[] calldata to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bool lenient,
        uint256 gasPerTransfer
    ) external nonReentrant returns (uint256 sent, uint256 skipped) {
        return _airdrop1155(token, to, ids, amounts, Opts(false, lenient, _checkGas(gasPerTransfer, lenient)));
    }

    function _airdrop1155(
        address token,
        address[] calldata to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        Opts memory o
    ) internal returns (uint256 sent, uint256 skipped) {
        uint256 n = to.length;
        if (n != ids.length || n != amounts.length) revert LengthMismatch();
        if (n == 0) revert EmptyBatch();
        _mustBeContract(token);
        for (uint256 i; i < n;) {
            address dst = to[i];
            if (dst == address(this)) revert SelfRecipient(i);
            if (amounts[i] == 0) revert ZeroAmount(i);           // a no-op is not a delivery
            if (o.lenient) {
                if (dst == address(0)) { ++skipped; emit Skipped(token, dst, ids[i], amounts[i], _zeroReason(i)); unchecked { ++i; } continue; }
                (bool ok, bytes memory reason) =
                    _tryCall(token, abi.encodeCall(IERC1155Like.safeTransferFrom, (msg.sender, dst, ids[i], amounts[i], "")), i, o.gasPerTransfer);
                if (ok) {
                    if (reason.length != 0) revert AmbiguousResult(dst, i);
                    ++sent;
                } else {
                    ++skipped;
                    emit Skipped(token, dst, ids[i], amounts[i], reason);
                }
            } else {
                if (dst == address(0)) revert ZeroRecipient(i);
                IERC1155Like(token).safeTransferFrom(msg.sender, dst, ids[i], amounts[i], "");
                uint256 rds;
                assembly ("memory-safe") { rds := returndatasize() }
                if (rds != 0) revert AmbiguousResult(dst, i);
            }
            unchecked { ++i; }
        }
        if (!o.lenient) sent = n;
        emit Airdrop1155(token, msg.sender, sent, skipped);
    }

    // ----------------------------------------------------------------- ERC-20

    /// @notice Send `amounts[i]` of an ERC-20 to each recipient. Tolerates tokens that return nothing.
    /// @dev Three outcomes, not two. A reverted call moved nothing and is safe to skip in lenient mode. A call
    ///      that returned exactly `true`, or nothing at all (USDT-style), delivered. A call that SUCCEEDED and
    ///      answered anything else is ambiguous: the balance may already have moved, so calling it "skipped"
    ///      would invite a second payment to someone who was already paid. That reverts the whole batch, which
    ///      undoes whatever it did, in both modes.
    function airdrop20(address token, address[] calldata to, uint256[] calldata amounts, bool lenient)
        external
        nonReentrant
        returns (uint256 sent, uint256 skipped)
    {
        return _airdrop20(token, to, amounts, Opts(false, lenient, DEFAULT_GAS));
    }

    /// @notice The same, with your own per-transfer gas stipend. Lenient mode only; `MIN_GAS` to `MAX_GAS`.
    function airdrop20WithGas(
        address token,
        address[] calldata to,
        uint256[] calldata amounts,
        bool lenient,
        uint256 gasPerTransfer
    ) external nonReentrant returns (uint256 sent, uint256 skipped) {
        return _airdrop20(token, to, amounts, Opts(false, lenient, _checkGas(gasPerTransfer, lenient)));
    }

    function _airdrop20(address token, address[] calldata to, uint256[] calldata amounts, Opts memory o)
        internal
        returns (uint256 sent, uint256 skipped)
    {
        uint256 n = to.length;
        if (n != amounts.length) revert LengthMismatch();
        if (n == 0) revert EmptyBatch();
        _mustBeContract(token);
        _mustNotBeNft(token, amounts[0], amounts[n - 1]);
        for (uint256 i; i < n;) {
            address dst = to[i];
            if (dst == address(this)) revert SelfRecipient(i);
            if (amounts[i] == 0) revert ZeroAmount(i);
            if (dst == address(0)) {
                if (!o.lenient) revert ZeroRecipient(i);
                ++skipped; emit Skipped(token, dst, 0, amounts[i], _zeroReason(i)); unchecked { ++i; } continue;
            }
            bytes memory data = abi.encodeCall(IERC20Like.transferFrom, (msg.sender, dst, amounts[i]));
            bool ok;
            bytes memory ret;
            if (o.lenient) {
                (ok, ret) = _tryCall(token, data, i, o.gasPerTransfer);
            } else {
                (ok, ret) = _callAll(token, data);
            }
            if (ok) {
                // Exactly nothing (USDT-style) or exactly one word holding 1. Trailing bytes after that word
                // are not a `bool`, and this contract has no business guessing what they were meant to be.
                if (_erc20Answer(ret) != ANSWER_DELIVERED) revert AmbiguousResult(dst, i);   // may have paid them
                ++sent;
            } else if (o.lenient) {
                ++skipped;
                emit Skipped(token, dst, 0, amounts[i], ret);
            } else {
                if (ret.length > 0) {
                    assembly ("memory-safe") { revert(add(ret, 32), mload(ret)) }   // the token said why; pass it on
                }
                revert TransferFailed(dst, 0);
            }
            unchecked { ++i; }
        }
        emit Airdrop20(token, msg.sender, sent, skipped);
    }

    // ---------------------------------------------------------------- internals

    /// @dev A stipend is only meaningful where transfers are attempted one at a time and allowed to fail.
    ///      Strict mode forwards everything and reverts the batch, so accepting a number there and ignoring
    ///      it would be a lie about what the transaction does.
    function _checkGas(uint256 gasPerTransfer, bool lenient) internal pure returns (uint256) {
        if (!lenient) revert GasIsForLenientOnly();
        if (gasPerTransfer < MIN_GAS || gasPerTransfer > MAX_GAS) revert GasOutOfRange(gasPerTransfer, MIN_GAS, MAX_GAS);
        return gasPerTransfer;
    }

    /// @dev Lenient-mode call: capped gas, capped returndata, and a hard stop if this transaction cannot
    ///      actually afford the stipend plus the cost of recording the result. Without that stop, EIP-150
    ///      silently clamps the stipend to 63/64 of what is left, an honest recipient fails for lack of gas,
    ///      and the batch reports it as the recipient's fault. It would also make `eth_estimateGas` settle on
    ///      a limit that skips recipients rather than delivering to them, since skipping is cheaper.
    ///      Reverting keeps the estimate honest.
    function _tryCall(address token, bytes memory data, uint256 index, uint256 stipend)
        internal
        returns (bool ok, bytes memory ret)
    {
        uint256 g = gasleft();
        if (g - g / 64 < stipend + GAS_RESERVE) revert OutOfGasForBatch(index);
        uint256 cap = REASON_CAP;
        assembly ("memory-safe") {
            ok := call(stipend, token, 0, add(data, 32), mload(data), 0, 0)
            let size := returndatasize()
            if gt(size, cap) { size := cap }
            ret := mload(0x40)
            mstore(ret, size)
            returndatacopy(add(ret, 32), 0, size)
            mstore(0x40, add(add(ret, 32), and(add(size, 31), not(31))))
        }
    }

    /// @dev Strict-mode ERC-20 call: all remaining gas, and the token's answer kept whole. Truncating it here
    ///      would hand back a fragment that no longer decodes as the error it came from, which is worse than
    ///      no reason at all. A batch that reverts costs the sender only this transaction, so there is nothing
    ///      to amplify: the returndata cap belongs to the lenient path, which keeps going.
    function _callAll(address token, bytes memory data) internal returns (bool ok, bytes memory ret) {
        assembly ("memory-safe") {
            ok := call(gas(), token, 0, add(data, 32), mload(data), 0, 0)
            let size := returndatasize()
            ret := mload(0x40)
            mstore(ret, size)
            returndatacopy(add(ret, 32), 0, size)
            mstore(0x40, add(add(ret, 32), and(add(size, 31), not(31))))
        }
    }

    /// @dev Refuses an address with NO code. That is all it does, and the distinction matters: a single 0x00
    ///      byte is code, so a contract that does nothing at all passes this and returns the same empty
    ///      success a USDT-style token returns. This guard catches a mistyped address, not an impostor. What
    ///      separates a real token from something wearing its shape cannot be settled on chain, which is why
    ///      the README says so under what this cannot promise, and why the page asks who holds what
    ///      afterwards rather than believing a counter.
    ///      An EIP-7702 wallet carries a 23-byte delegation designator (0xef0100 + address), which is code but
    ///      is not a token; treated as a mistyped address rather than something to call.
    /// @dev One staticcall per batch, not per row. A contract with no `ownerOf` reverts with empty
    ///      returndata; an ERC-721 that simply will not answer for this id reverts with its own error, which
    ///      carries data. Only the first is grounds for refusing the batch.
    function _mustBeNft(address token, uint256 probeA, uint256 probeB) internal view {
        if (_answersOwnerOf(token, probeA)) return;
        // A revert with empty returndata is not proof of anything. `require(cond);` with no reason string
        // compiles to revert(0,0), which is what the Vyper reference ERC-721 and any bare assert produce, so a
        // real collection refusing an id that was burned or never minted looks identical to a contract with no
        // such function. Two cheap ways out before refusing a batch, both in the failure path only.
        if (probeB != probeA && _answersOwnerOf(token, probeB)) return;   // a different id from the same list
        // And the question this page asks everywhere else for exactly this: does it claim to be one.
        (bool ok165, bytes memory r165) =
            token.staticcall(abi.encodeWithSelector(0x01ffc9a7, bytes4(0x80ac58cd)));   // supportsInterface(ERC721)
        if (ok165 && r165.length == 32 && abi.decode(r165, (uint256)) == 1) return;
        revert NotAnNft(token);
    }

    uint8 internal constant ANSWER_DELIVERED = 0;
    uint8 internal constant ANSWER_UNREADABLE = 2;

    /// @dev What an ERC-20 said. Nothing at all is a USDT-style success, and exactly `1` is a success.
    ///      EVERYTHING else, `false` included, is unreadable and takes the batch down.
    ///      Round twelve argued that `false` should be skipped in lenient mode instead, because the standard
    ///      defines it as "I did not transfer" and a conforming token answering it has moved nothing. That is
    ///      right about conforming tokens, and this contract cannot know it has one: PaysThenLies20 in this
    ///      repository's own fixtures moves the balance and then answers false. Nothing observable from here
    ///      separates the two, and reporting a payment that happened as a skip is how a retry pays someone
    ///      twice. Kept out of the loop because _airdrop20 sits on the stack limit.
    function _erc20Answer(bytes memory ret) private pure returns (uint8) {
        if (ret.length == 0) return ANSWER_DELIVERED;
        if (ret.length != 32) return ANSWER_UNREADABLE;
        return abi.decode(ret, (uint256)) == 1 ? ANSWER_DELIVERED : ANSWER_UNREADABLE;
    }

    function _answersOwnerOf(address token, uint256 id) private view returns (bool) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeCall(IERC721Like.ownerOf, (id)));
        return ok && ret.length == 32;
    }

    /// @dev The mirror of _mustBeNft, and it exists for the same reason: `transferFrom(address,address,uint256)`
    ///      is one selector for both standards, and a conforming ERC-721 returns nothing, which the ERC-20
    ///      path reads as a USDT-style success. Without this, an ERC-721 through airdrop20 spends its token
    ///      IDS as amounts -- NFTs leave the sender, and the counter and the Airdrop20 event both report a
    ///      token airdrop that never happened. v11 closed this direction for airdrop721 and left the mirror.
    ///      It cannot be perfect: a hybrid can answer both. Neither can _mustBeNft, for the same reason.
    ///
    ///      v12 called this a mirror and it was not one. _mustBeNft had just been taught that probing a single
    ///      id is not enough -- the id in hand can be burned or never minted -- and this was written the same
    ///      day probing one value. Demonstrated on chain against v12: a sender holding ids 2 and 3, with id 1
    ///      unminted, pasting the collection into the ERC-20 form emitted two real ERC-721 Transfer events and
    ///      an Airdrop20(sent 2, skipped 1) in the same transaction. Two NFTs gone, called a token airdrop.
    ///      So it is now the same shape as its twin, and the order is deliberate: supportsInterface is asked
    ///      first because it is the only one of the three that does not depend on which ids the sender
    ///      happened to type.
    ///
    ///      The cost is not symmetrical with _mustBeNft and that is worth stating. There the extra probes run
    ///      only when the first one fails, so an ordinary airdrop never pays them. Here all three run on every
    ///      ERC-20 batch: about three staticcalls, ~7,800 gas, against a batch that costs tens of millions.
    function _mustNotBeNft(address token, uint256 probeA, uint256 probeB) internal view {
        (bool ok165, bytes memory r165) =
            token.staticcall(abi.encodeWithSelector(0x01ffc9a7, bytes4(0x80ac58cd)));   // supportsInterface(ERC721)
        if (ok165 && r165.length == 32 && abi.decode(r165, (uint256)) == 1) revert IsAnNft(token);
        if (_answersOwnerOf(token, probeA)) revert IsAnNft(token);
        if (probeB != probeA && _answersOwnerOf(token, probeB)) revert IsAnNft(token);
    }

    function _mustBeContract(address token) internal view {
        uint256 len = token.code.length;
        if (len == 0) revert NotAContract(token);
        if (len == 23) {
            bytes3 prefix;
            assembly ("memory-safe") {
                let ptr := mload(0x40)
                extcodecopy(token, ptr, 0, 3)
                prefix := mload(ptr)
            }
            if (prefix == 0xef0100) revert DelegatedWallet(token);
        }
    }
}
