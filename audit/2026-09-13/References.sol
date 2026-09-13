// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {BulkSend, IERC721Like, IERC1155Like, IERC20Like} from "../../src/BulkSend.sol";

// AUDIT ONLY. Never deploy as a product. Inherits the existing call helpers/lock to
// avoid introducing new assembly. Reference omits classification, summaries and
// lenient policy; retains caller binding, shape/recipient checks and return checks.
contract FloorReference is BulkSend {
    function check(address token, uint256 n) internal view {
        if (n == 0) revert EmptyBatch();
        _mustBeContract(token);
    }
    function dstCheck(address dst, uint256 i) internal view {
        if (dst == address(0)) revert ZeroRecipient(i);
        if (dst == address(this)) revert SelfRecipient(i);
    }
    function send20(address token, address dst, uint256 amount, uint256 i) internal {
        if (amount == 0) revert ZeroAmount(i);
        (bool ok, bytes memory ret) = _callAll(token, abi.encodeCall(IERC20Like.transferFrom, (msg.sender, dst, amount)));
        require(ok, "transfer reverted");
        if (ret.length != 0 && (ret.length != 32 || abi.decode(ret, (uint256)) != 1)) revert AmbiguousResult(dst, i);
    }
    function send721(address token, address dst, uint256 id, bool safe, uint256 i) internal {
        if (safe) IERC721Like(token).safeTransferFrom(msg.sender, dst, id);
        else IERC721Like(token).transferFrom(msg.sender, dst, id);
        uint256 size;
        assembly ("memory-safe") { size := returndatasize() }
        if (size != 0) revert AmbiguousResult(dst, i);
    }
    function send1155(address token, address dst, uint256 id, uint256 amount, uint256 i) internal {
        if (amount == 0) revert ZeroAmount(i);
        IERC1155Like(token).safeTransferFrom(msg.sender, dst, id, amount, "");
        uint256 size;
        assembly ("memory-safe") { size := returndatasize() }
        if (size != 0) revert AmbiguousResult(dst, i);
    }
    function ref20(address token, address[] calldata to, uint256[] calldata amounts) external nonReentrant {
        check(token, to.length);
        if (to.length != amounts.length) revert LengthMismatch();
        for (uint256 i; i < to.length; ++i) {
            address dst = to[i];
            if (dst == address(0)) revert ZeroRecipient(i);
            if (dst == address(this)) revert SelfRecipient(i);
            if (amounts[i] == 0) revert ZeroAmount(i);
            (bool ok, bytes memory ret) = _callAll(token, abi.encodeCall(IERC20Like.transferFrom, (msg.sender, dst, amounts[i])));
            require(ok, "transfer reverted");
            if (ret.length != 0 && (ret.length != 32 || abi.decode(ret, (uint256)) != 1)) revert AmbiguousResult(dst, i);
        }
    }
    function ref721(address token, address[] calldata to, uint256[] calldata ids, bool safe) external nonReentrant {
        check(token, to.length);
        if (to.length != ids.length) revert LengthMismatch();
        for (uint256 i; i < to.length; ++i) {
            address dst = to[i];
            if (dst == address(0)) revert ZeroRecipient(i);
            if (dst == address(this)) revert SelfRecipient(i);
            if (safe) IERC721Like(token).safeTransferFrom(msg.sender, dst, ids[i]);
            else IERC721Like(token).transferFrom(msg.sender, dst, ids[i]);
            uint256 size;
            assembly ("memory-safe") { size := returndatasize() }
            if (size != 0) revert AmbiguousResult(dst, i);
        }
    }
    function ref1155(address token, address[] calldata to, uint256[] calldata ids, uint256[] calldata amounts) external nonReentrant {
        check(token, to.length);
        if (to.length != ids.length || to.length != amounts.length) revert LengthMismatch();
        for (uint256 i; i < to.length; ++i) {
            address dst = to[i];
            if (dst == address(0)) revert ZeroRecipient(i);
            if (dst == address(this)) revert SelfRecipient(i);
            if (amounts[i] == 0) revert ZeroAmount(i);
            IERC1155Like(token).safeTransferFrom(msg.sender, dst, ids[i], amounts[i], "");
            uint256 size;
            assembly ("memory-safe") { size := returndatasize() }
            if (size != 0) revert AmbiguousResult(dst, i);
        }
    }
    // Strict-only shape prototypes. Keep production classification, lock, summary,
    // recipient and return checks. No calldata packing or new low-level machinery.
    function equal20(address token, address[] calldata to, uint256 amount) external nonReentrant returns (uint256, uint256) {
        check(token, to.length); _mustNotBeNft(token, amount, amount);
        for (uint256 i; i < to.length; ++i) { dstCheck(to[i], i); send20(token, to[i], amount, i); }
        emit Airdrop20(token, msg.sender, to.length, 0); return (to.length, 0);
    }
    function sequential721(address token, address[] calldata to, uint256 start, bool safe) external nonReentrant returns (uint256, uint256) {
        check(token, to.length); _mustBeNft(token, start, start + to.length - 1);
        for (uint256 i; i < to.length; ++i) { dstCheck(to[i], i); send721(token, to[i], start + i, safe, i); }
        emit Airdrop721(token, msg.sender, to.length, 0); return (to.length, 0);
    }
    function equal1155(address token, address[] calldata to, uint256 id, uint256 amount) external nonReentrant returns (uint256, uint256) {
        check(token, to.length);
        for (uint256 i; i < to.length; ++i) { dstCheck(to[i], i); send1155(token, to[i], id, amount, i); }
        emit Airdrop1155(token, msg.sender, to.length, 0); return (to.length, 0);
    }
}
