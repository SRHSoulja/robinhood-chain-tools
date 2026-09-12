// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {BulkSend} from "../src/BulkSend.sol";
import {MockERC721} from "../test/Mocks.sol";

/// The key comes from the environment, never from an argument: `--private-key $PK` puts the key in the
/// process's argument list for as long as the command runs, where any process of the same user can read it.
/// An exported variable is visible only through the process's own environment.
///
///   export RH_DEPLOYER_PK="$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.config/rh-airdrop/deployer.json')))['private_key'])")"
///   forge script script/Deploy.s.sol:DeployBulkSend --rpc-url $RH_RPC --broadcast
///   unset RH_DEPLOYER_PK
contract DeployBulkSend is Script {
    function run() external {
        uint256 pk = vm.envUint("RH_DEPLOYER_PK");
        require(block.chainid == 46630, "testnet only: mainnet needs a clean round and explicit permission, and neither is given here");
        vm.startBroadcast(pk);
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

/// Mainnet, chain 4663, and nothing else. Same shape as the testnet deployer above, same key discipline (the key
/// comes from the environment, never an argument), and its own guard so this entry point can never be pointed at
/// the wrong chain by a wrong RPC. It exists as a separate contract so the testnet guard above stays exactly as
/// reviewed. Run only on the maintainer's explicit word, after a rehearsal on a fork of mainnet:
///
///   export RH_RPC=https://rpc.mainnet.chain.robinhood.com
///   export RH_DEPLOYER_PK="$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.config/rh-airdrop/deployer.json')))['private_key'])")"
///   forge script script/Deploy.s.sol:DeployBulkSendMainnet --rpc-url $RH_RPC --broadcast
///   unset RH_DEPLOYER_PK
contract DeployBulkSendMainnet is Script {
    function run() external {
        uint256 pk = vm.envUint("RH_DEPLOYER_PK");
        require(block.chainid == 4663, "mainnet only: this entry point deploys to Robinhood Chain 4663 and refuses every other chain");
        vm.startBroadcast(pk);
        BulkSend b = new BulkSend();
        vm.stopBroadcast();
        console2.log("BulkSend", address(b));
    }
}

