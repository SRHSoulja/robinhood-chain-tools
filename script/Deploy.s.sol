// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {BulkSend} from "../src/BulkSend.sol";
import {MockERC721} from "../test/Mocks.sol";

/// forge script script/Deploy.s.sol:DeployBulkSend --rpc-url $RH_RPC --private-key $PK --broadcast
contract DeployBulkSend is Script {
    function run() external {
        vm.startBroadcast();
        BulkSend b = new BulkSend();
        vm.stopBroadcast();
        console2.log("BulkSend", address(b));
    }
}

/// Testnet rehearsal only: a throwaway mintable collection so the airdrop can be exercised end to end.
/// forge script script/Deploy.s.sol:DeployRehearsalNFT --rpc-url $RH_RPC --private-key $PK --broadcast
contract DeployRehearsalNFT is Script {
    function run() external {
        vm.startBroadcast();
        MockERC721 n = new MockERC721();
        vm.stopBroadcast();
        console2.log("RehearsalNFT", address(n));
    }
}
