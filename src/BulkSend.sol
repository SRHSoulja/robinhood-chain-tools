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
interface IERC721Like {
    function transferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
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
    error DelegatedWallet(address token);
    error SelfRecipient(uint256 index);
    error ZeroAmount(uint256 index);
    error AmbiguousResult(address to, uint256 index);
    error ZeroRecipient(uint256 index);
    error OutOfGasForBatch(uint256 index);
    error GasOutOfRange(uint256 given, uint256 min, uint256 max);
    error GasIsForLenientOnly();

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
    bytes internal constant ZERO_REASON = hex"9fabe1c1";

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
    ) external returns (uint256 sent, uint256 skipped) {
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
        for (uint256 i; i < n;) {
            address dst = to[i];
            if (dst == address(this)) revert SelfRecipient(i);   // nothing here can ever give it back
            if (o.lenient) {
                if (dst == address(0)) { ++skipped; emit Skipped(token, dst, ids[i], 1, ZERO_REASON); unchecked { ++i; } continue; }
                (bool ok, bytes memory reason) = _tryCall(
                    token,
                    o.safe
                        ? abi.encodeCall(IERC721Like.safeTransferFrom, (msg.sender, dst, ids[i]))
                        : abi.encodeCall(IERC721Like.transferFrom, (msg.sender, dst, ids[i])),
                    i,
                    o.gasPerTransfer
                );
                if (ok) {
                    ++sent;
                } else {
                    ++skipped;
                    emit Skipped(token, dst, ids[i], 1, reason);
                }
            } else {
                if (dst == address(0)) revert ZeroRecipient(i);
                if (o.safe) IERC721Like(token).safeTransferFrom(msg.sender, dst, ids[i]);
                else IERC721Like(token).transferFrom(msg.sender, dst, ids[i]);
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
    ) external returns (uint256 sent, uint256 skipped) {
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
    ) external returns (uint256 sent, uint256 skipped) {
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
                if (dst == address(0)) { ++skipped; emit Skipped(token, dst, ids[i], amounts[i], ZERO_REASON); unchecked { ++i; } continue; }
                (bool ok, bytes memory reason) =
                    _tryCall(token, abi.encodeCall(IERC1155Like.safeTransferFrom, (msg.sender, dst, ids[i], amounts[i], "")), i, o.gasPerTransfer);
                if (ok) {
                    ++sent;
                } else {
                    ++skipped;
                    emit Skipped(token, dst, ids[i], amounts[i], reason);
                }
            } else {
                if (dst == address(0)) revert ZeroRecipient(i);
                IERC1155Like(token).safeTransferFrom(msg.sender, dst, ids[i], amounts[i], "");
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
    ) external returns (uint256 sent, uint256 skipped) {
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
        for (uint256 i; i < n;) {
            address dst = to[i];
            if (dst == address(this)) revert SelfRecipient(i);
            if (amounts[i] == 0) revert ZeroAmount(i);
            if (dst == address(0)) {
                if (!o.lenient) revert ZeroRecipient(i);
                ++skipped; emit Skipped(token, dst, 0, amounts[i], ZERO_REASON); unchecked { ++i; } continue;
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
                bool answeredTrue = ret.length == 0 || (ret.length >= 32 && abi.decode(ret, (uint256)) == 1);
                if (!answeredTrue) revert AmbiguousResult(dst, i);   // it may have paid them; do not call this a skip
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

    /// @dev A low-level call to an address with no code "succeeds" with empty return data, which is also what
    ///      USDT-style tokens return on success. So the token must be a contract before any batch runs.
    ///      An EIP-7702 wallet carries a 23-byte delegation designator (0xef0100 + address), which is code but
    ///      is not a token; treated as a mistyped address rather than something to call.
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
