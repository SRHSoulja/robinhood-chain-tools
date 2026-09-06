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
///            rest is delivered. Each transfer gets at most `LENIENT_GAS`, so one recipient that burns gas
///            cannot starve the batch, and at most `REASON_CAP` bytes of its revert data are kept, so one
///            recipient returning megabytes cannot inflate the batch's memory cost.
///
/// A recipient skipped in lenient mode with "cannot receive" may simply need more than `LENIENT_GAS`.
/// Send that one on its own in strict mode, where the whole transaction's gas is available to it.
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
    error ZeroRecipient(uint256 index);
    error OutOfGasForBatch(uint256 index);

    /// @notice Gas given to one transfer (and its recipient's receive hook) in lenient mode.
    /// @dev Without a cap, EIP-150 hands a callee 63/64 of the remaining gas, so one recipient whose hook
    ///      burns everything leaves the loop with 1/64 and the rest of the batch runs dry: exactly what
    ///      lenient mode promises not to do. Measured honest recipients (OpenZeppelin ERC-721/1155, ERC721A
    ///      crossing an uninitialized ownership slot, smart-contract wallets) land well under this.
    uint256 public constant LENIENT_GAS = 400_000;

    /// @dev Reason emitted when a lenient batch is asked to send to the zero address. The transfer is skipped
    ///      rather than attempted: some tokens treat the zero address as a burn, and burning someone's NFT
    ///      because of a stray line in a spreadsheet is not a recoverable mistake. Strict mode reverts instead.
    bytes internal constant ZERO_REASON = hex"9fabe1c1";

    /// @notice Bytes of a failed transfer's revert data kept for the `Skipped` event.
    /// @dev A hostile recipient can revert with megabytes; copying and emitting all of it is a gas amplifier.
    ///      128 bytes holds any custom error with a few arguments and the front of an `Error(string)`.
    uint256 internal constant REASON_CAP = 128;

    /// @notice Send one ERC-721 id to each recipient. `safe` uses safeTransferFrom (recipient contracts must accept).
    function airdrop721(address token, address[] calldata to, uint256[] calldata ids, bool safe, bool lenient)
        external
        returns (uint256 sent, uint256 skipped)
    {
        uint256 n = to.length;
        if (n != ids.length) revert LengthMismatch();
        if (n == 0) revert EmptyBatch();
        _mustBeContract(token);
        for (uint256 i; i < n;) {
            address dst = to[i];
            if (lenient) {
                if (dst == address(0)) { ++skipped; emit Skipped(token, dst, ids[i], 1, ZERO_REASON); unchecked { ++i; } continue; }
                bytes memory data = safe
                    ? abi.encodeCall(IERC721Like.safeTransferFrom, (msg.sender, dst, ids[i]))
                    : abi.encodeCall(IERC721Like.transferFrom, (msg.sender, dst, ids[i]));
                (bool ok, bytes memory reason) = _tryCall(token, data, i);
                if (ok) {
                    ++sent;
                } else {
                    ++skipped;
                    emit Skipped(token, dst, ids[i], 1, reason);
                }
            } else {
                if (dst == address(0)) revert ZeroRecipient(i);
                if (safe) IERC721Like(token).safeTransferFrom(msg.sender, dst, ids[i]);
                else IERC721Like(token).transferFrom(msg.sender, dst, ids[i]);
            }
            unchecked { ++i; }
        }
        if (!lenient) sent = n;   // strict mode delivers every entry or reverts, so counting in the loop is wasted gas
        emit Airdrop721(token, msg.sender, sent, skipped);
    }

    /// @notice Send `amounts[i]` of ERC-1155 `ids[i]` to each recipient.
    function airdrop1155(
        address token,
        address[] calldata to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bool lenient
    ) external returns (uint256 sent, uint256 skipped) {
        uint256 n = to.length;
        if (n != ids.length || n != amounts.length) revert LengthMismatch();
        if (n == 0) revert EmptyBatch();
        _mustBeContract(token);
        for (uint256 i; i < n;) {
            address dst = to[i];
            if (lenient) {
                if (dst == address(0)) { ++skipped; emit Skipped(token, dst, ids[i], amounts[i], ZERO_REASON); unchecked { ++i; } continue; }
                (bool ok, bytes memory reason) =
                    _tryCall(token, abi.encodeCall(IERC1155Like.safeTransferFrom, (msg.sender, dst, ids[i], amounts[i], "")), i);
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
        if (!lenient) sent = n;
        emit Airdrop1155(token, msg.sender, sent, skipped);
    }

    /// @notice Send `amounts[i]` of an ERC-20 to each recipient. Tolerates tokens that return nothing.
    /// @dev A token that moves the balance and then returns data that is not exactly `true` is counted as a
    ///      failure. That is deliberate (fail closed), so the skip report reflects the token's answer, not a
    ///      balance check; re-sending to a skipped wallet on such a token could pay it twice.
    function airdrop20(address token, address[] calldata to, uint256[] calldata amounts, bool lenient)
        external
        returns (uint256 sent, uint256 skipped)
    {
        uint256 n = to.length;
        if (n != amounts.length) revert LengthMismatch();
        if (n == 0) revert EmptyBatch();
        _mustBeContract(token);
        for (uint256 i; i < n;) {
            address dst = to[i];
            if (dst == address(0)) {
                if (!lenient) revert ZeroRecipient(i);
                ++skipped; emit Skipped(token, dst, 0, amounts[i], ZERO_REASON); unchecked { ++i; } continue;
            }
            bytes memory data = abi.encodeCall(IERC20Like.transferFrom, (msg.sender, dst, amounts[i]));
            bool ok;
            bytes memory ret;
            if (lenient) {
                (ok, ret) = _tryCall(token, data, i);
            } else {
                (ok, ret) = _callAll(token, data);
            }
            bool good = ok && (ret.length == 0 || (ret.length >= 32 && abi.decode(ret, (uint256)) == 1));
            if (good) {
                ++sent;
            } else if (lenient) {
                ++skipped;
                emit Skipped(token, dst, 0, amounts[i], ret);
            } else {
                revert TransferFailed(dst, 0);
            }
            unchecked { ++i; }
        }
        emit Airdrop20(token, msg.sender, sent, skipped);
    }

    /// @dev Lenient-mode call: capped gas, capped returndata, and a hard stop if this transaction cannot
    ///      actually afford the stipend. Without that stop, EIP-150 silently clamps the stipend to 63/64 of
    ///      what is left, an honest recipient fails for lack of gas, and the batch reports it as the
    ///      recipient's fault. It would also make `eth_estimateGas` settle on a limit that skips recipients
    ///      rather than delivering to them, since skipping is cheaper. Reverting keeps the estimate honest.
    function _tryCall(address token, bytes memory data, uint256 index) internal returns (bool ok, bytes memory ret) {
        uint256 g = gasleft();
        if (g - g / 64 < LENIENT_GAS) revert OutOfGasForBatch(index);
        uint256 cap = REASON_CAP;
        assembly ("memory-safe") {
            ok := call(LENIENT_GAS, token, 0, add(data, 32), mload(data), 0, 0)
            let size := returndatasize()
            if gt(size, cap) { size := cap }
            ret := mload(0x40)
            mstore(ret, size)
            returndatacopy(add(ret, 32), 0, size)
            mstore(0x40, add(add(ret, 32), and(add(size, 31), not(31))))
        }
    }

    /// @dev Strict-mode ERC-20 call: all remaining gas, returndata capped anyway (it is only read, never bubbled).
    function _callAll(address token, bytes memory data) internal returns (bool ok, bytes memory ret) {
        uint256 cap = REASON_CAP;
        assembly ("memory-safe") {
            ok := call(gas(), token, 0, add(data, 32), mload(data), 0, 0)
            let size := returndatasize()
            if gt(size, cap) { size := cap }
            ret := mload(0x40)
            mstore(ret, size)
            returndatacopy(add(ret, 32), 0, size)
            mstore(0x40, add(add(ret, 32), and(add(size, 31), not(31))))
        }
    }

    /// @dev A low-level call to an address with no code "succeeds" with empty return data, which is also what
    ///      USDT-style tokens return on success. So the token must be a contract before any batch runs.
    function _mustBeContract(address token) internal view {
        if (token.code.length == 0) revert NotAContract(token);
    }
}
