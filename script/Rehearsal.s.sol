// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {OZ721, A721, OZ1155, OZ20, NoReturn20} from "../test/RealTokens.sol";

/// Testnet rehearsal tokens, real implementations (OpenZeppelin v5, ERC721A), minted to the deployer.
/// forge script script/Rehearsal.s.sol:DeployRehearsalTokens --rpc-url $RH_RPC --private-key $PK --broadcast
contract DeployRehearsalTokens is Script {
    function run() external {
        address me = vm.addr(vm.envUint("PK"));
        vm.startBroadcast();
        OZ721 oz721 = new OZ721(); oz721.mintMany(me, 1, 300);
        A721 a721 = new A721(); a721.mint(me, 300);
        OZ1155 oz1155 = new OZ1155(); oz1155.mint(me, 1, 100_000); oz1155.mint(me, 2, 100_000);
        OZ20 oz20 = new OZ20(); oz20.mint(me, 1_000_000e18);
        NoReturn20 nr20 = new NoReturn20(); nr20.mint(me, 1_000_000e6);
        vm.stopBroadcast();
        console2.log("OZ721", address(oz721)); console2.log("A721", address(a721)); console2.log("OZ1155", address(oz1155)); console2.log("OZ20", address(oz20)); console2.log("NoReturn20", address(nr20));
    }
}
