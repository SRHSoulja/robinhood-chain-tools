// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
/// Runs as the wallet itself under EIP-7702: address(this) is the owner's own address, so every
/// transferFrom below has msg.sender == the owner. No approval, and a creator transfer validator
/// sees an owner-initiated transfer rather than a third-party operator.
interface IERC721 { function transferFrom(address from, address to, uint256 id) external; }
contract SelfBatch {
    error NotSelf();
    function send721(address token, address[] calldata to, uint256[] calldata ids) external {
        if (msg.sender != address(this)) revert NotSelf();   // only the wallet itself may drive this
        for (uint256 i; i < to.length;) { IERC721(token).transferFrom(address(this), to[i], ids[i]); unchecked { ++i; } }
    }
}
