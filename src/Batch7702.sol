// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Batch7702 — the shape a wallet delegates to under EIP-7702 so it can run several calls as itself.
/// @notice Reference implementation used to exercise the wallet-batch path end to end. A production wallet
///         ships its own; this exists so the airdrop page can be tested against the real mechanism.
///         Stateless on purpose: EIP-7702 code runs against the wallet's own storage, so writing anything here
///         would collide with whatever the wallet delegates to next.
contract Batch7702 {
    struct Call { address to; uint256 value; bytes data; }

    error NotSelf();

    /// @dev Only the wallet itself may drive this. A transaction the owner signs to their own address arrives
    ///      with msg.sender == address(this); anyone else calling the delegated wallet is rejected here.
    function execute(Call[] calldata calls) external payable {
        if (msg.sender != address(this)) revert NotSelf();
        for (uint256 i; i < calls.length;) {
            (bool ok, bytes memory ret) = calls[i].to.call{value: calls[i].value}(calls[i].data);
            if (!ok) {
                assembly { revert(add(ret, 32), mload(ret)) }
            }
            unchecked { ++i; }
        }
    }
}
