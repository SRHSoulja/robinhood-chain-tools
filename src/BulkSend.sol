// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BulkSend — batch airdrops of ERC-721, ERC-1155 and ERC-20 on Robinhood Chain
/// @notice Holds nothing. Every transfer is `transferFrom(msg.sender, ...)`, so the contract can only
///         move what the caller approved, inside the transaction the caller signed. No owner, no
///         upgrade path, no fees, no pause. If you want it to stop, stop calling it.
/// @dev    `lenient` mode wraps each transfer in try/catch and emits `Skipped` instead of reverting the
///         whole batch when one recipient cannot receive (a contract without a receiver hook, a burned
///         id, a paused token). Strict mode reverts on the first failure.
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

    /// @dev A low-level call to an address with no code "succeeds" with empty return data, which is also what
    ///      USDT-style tokens return on success. So the token must be a contract before any batch runs.
    function _mustBeContract(address token) internal view {
        if (token.code.length == 0) revert NotAContract(token);
    }

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
            if (lenient) {
                bool ok = _try721(token, to[i], ids[i], safe);
                if (ok) ++sent; else ++skipped;
            } else {
                if (safe) IERC721Like(token).safeTransferFrom(msg.sender, to[i], ids[i]);
                else IERC721Like(token).transferFrom(msg.sender, to[i], ids[i]);
                ++sent;
            }
            unchecked { ++i; }
        }
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
            if (lenient) {
                try IERC1155Like(token).safeTransferFrom(msg.sender, to[i], ids[i], amounts[i], "") {
                    ++sent;
                } catch (bytes memory reason) {
                    ++skipped;
                    emit Skipped(token, to[i], ids[i], amounts[i], reason);
                }
            } else {
                IERC1155Like(token).safeTransferFrom(msg.sender, to[i], ids[i], amounts[i], "");
                ++sent;
            }
            unchecked { ++i; }
        }
        emit Airdrop1155(token, msg.sender, sent, skipped);
    }

    /// @notice Send `amounts[i]` of an ERC-20 to each recipient. Tolerates tokens that return nothing.
    function airdrop20(address token, address[] calldata to, uint256[] calldata amounts, bool lenient)
        external
        returns (uint256 sent, uint256 skipped)
    {
        uint256 n = to.length;
        if (n != amounts.length) revert LengthMismatch();
        if (n == 0) revert EmptyBatch();
        _mustBeContract(token);
        for (uint256 i; i < n;) {
            (bool ok, bytes memory ret) =
                token.call(abi.encodeWithSelector(IERC20Like.transferFrom.selector, msg.sender, to[i], amounts[i]));
            bool good = ok && (ret.length == 0 || abi.decode(ret, (bool)));
            if (good) {
                ++sent;
            } else if (lenient) {
                ++skipped;
                emit Skipped(token, to[i], 0, amounts[i], ret);
            } else {
                revert TransferFailed(to[i], 0);
            }
            unchecked { ++i; }
        }
        emit Airdrop20(token, msg.sender, sent, skipped);
    }

    function _try721(address token, address to, uint256 id, bool safe) internal returns (bool) {
        if (safe) {
            try IERC721Like(token).safeTransferFrom(msg.sender, to, id) { return true; }
            catch (bytes memory reason) { emit Skipped(token, to, id, 1, reason); return false; }
        } else {
            try IERC721Like(token).transferFrom(msg.sender, to, id) { return true; }
            catch (bytes memory reason) { emit Skipped(token, to, id, 1, reason); return false; }
        }
    }
}
