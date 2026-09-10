// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BulkSend} from "../../src/BulkSend.sol";

/// The paste guards, asked about REAL contracts instead of fixtures this repository wrote.
///
/// Everything here runs on a local fork of Robinhood Chain mainnet. A fork is a sandbox: no transaction is
/// sent, no gas is spent, and the mainnet rule is untouched. That is what makes this affordable to run, and
/// it is the answer to the standing weakness of a mocked suite -- a mock answers `ownerOf` however the test
/// tells it to, so a guard tested only against mocks has been asked nothing.
///
/// The addresses were found by scanning mainnet for Transfer events and splitting them by topic count:
/// four topics means an indexed tokenId, which is ERC-721; three means the value is in data, which is ERC-20.
/// No explorer, no curated list, no judgement about which contracts are interesting.
contract GuardHarness is BulkSend {
    function checkNotNft(address t, uint256 a, uint256 b) external view { _mustNotBeNft(t, a, b); }
    function checkIsNft(address t, uint256 a, uint256 b) external view { _mustBeNft(t, a, b); }

    /// v12's guard, kept verbatim so the fix can be shown to change something rather than asserted to.
    /// One probe, on amounts[0]. This is what shipped, and what let two real NFTs out of a wallet on chain.
    function checkNotNft_v12(address t, uint256 probeAmount) external view {
        // _answersOwnerOf is private in BulkSend, so v12's body is written out here rather than called.
        (bool ok, bytes memory ret) = t.staticcall(abi.encodeWithSignature("ownerOf(uint256)", probeAmount));
        if (ok && ret.length == 32) revert IsAnNft(t);
    }
}

contract MainnetGuardsForkTest is Test {
    GuardHarness g;

    function setUp() public {
        vm.createSelectFork("https://rpc.mainnet.chain.robinhood.com");
        g = new GuardHarness();
    }

    function _nfts() internal pure returns (address[20] memory a) {
        a[0] = 0xdFa5D366Cc9B2bdf08d44A7d7e891012C893385b;
        a[1] = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
        a[2] = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
        a[3] = 0xf7B66Fd173aCA636bF8488B3648624446b9fb4b4;
        a[4] = 0xE02777B5D450BFD8D076c71174BF711C93dbAC92;
        a[5] = 0xf9358C2d8758c01cEA75B257570b809Bc1ebCF57;
        a[6] = 0x4380C896705C29E6b367Ec5c73c11a79D0F8932a;
        a[7] = 0x07F44c47743A2f36414A82b9F558ECFCf0EEdCEf;
        a[8] = 0x027ACa2794E44f24950D81227DcD516FfBB49d6e;
        a[9] = 0x5E9819f789abc56F988Ac1e992bebf41bf18cdC0;
        a[10] = 0x54a446143edD8AA845d9A6c8A4ca3628780A20ED;
        a[11] = 0x38c3619C9302dF61EB5De5134DCBfa3e875149d6;
        a[12] = 0xa0453EB455FC2002B554631906DfdB718b013D42;
        a[13] = 0xd0b6Fb4EC866eB4bbC2b507bb0fD8183349AC85F;
        a[14] = 0x8C61E265CC6d567d20BAFCed49c788603327B905;
        a[15] = 0x95d412b97e9e72f6d6B2a3eD3C2EFD9b5B3b8a41;
        a[16] = 0xEA21B37bc36a21E0B6261CF63355b47e213c6a61;
        a[17] = 0x46631290B2d47a2f705E232a5Ab1ab8936852697;
        a[18] = 0xe3b34C4bb0f12C82143745EEe6A6Cf4E3154b1fa;
        a[19] = 0xd32C947348Ebcf17939fA0CBBC5E3560ca7302FE;
    }

    function _tokens() internal pure returns (address[20] memory a) {
        a[0] = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
        a[1] = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
        a[2] = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;
        a[3] = 0x85Ef2Ee4cA09D19b03A7C5647c9776Bf4F6785A4;
        a[4] = 0x3385469427FB90c296394998c250eD3fBe8e18E1;
        a[5] = 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3;
        a[6] = 0xbbAB316A1A22c6C8a2b91D5F2b8bF47D32024875;
        a[7] = 0x4Eb990547BCe4a982432CA88Cf5fae7EED1A2d35;
        a[8] = 0x40BE5CC3B109186119a06dDA7fb699C4e303FB07;
        a[9] = 0x7F362D5EF8b02cedF2B5C5f76b9D7Aaa667085C8;
        a[10] = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
        a[11] = 0x600A5bbB67EB4e405f9aAE72f3E049a3888eeF68;
        a[12] = 0xcc8747B596DF1836da106956b475FdB1F4Af7e90;
        a[13] = 0xd78b50156279eC03de796c131198AEA3ad9A1e18;
        a[14] = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
        a[15] = 0xd07b2001d0713ba95c9b89eeF3d6C672cf35e12F;
        a[16] = 0x22d141f768b4dc6108C1E8712B10aca9A5C603dc;
        a[17] = 0x5D2CA17278A41d3563F2c7445081d6903EE0731E;
        a[18] = 0x72CB010E238Fc24EEfCb027cE4c38d49eb970000;
        a[19] = 0xB8c3B756FfdC1D81E42C3f02143035bF0C8612EA;
    }

    /// Every real ERC-721 on this chain must be REFUSED by the ERC-20 path. The amounts are deliberately NOT
    /// plausible token ids: 1e18 is what someone types when they mean "one token", and it is exactly the
    /// shape that defeated the one-probe guard, because ownerOf(1e18) reverts on every real collection.
    function test_every_real_nft_is_refused_by_the_erc20_guard() public {
        address[20] memory a = _nfts();
        uint256 refused;
        for (uint256 i; i < a.length; i++) {
            try g.checkNotNft(a[i], 1e18, 2e18) { emit log_named_address("NOT refused", a[i]); }
            catch { refused++; }
        }
        emit log_named_uint("real ERC-721 collections refused", refused);
        assertEq(refused, a.length, "a real collection got through the ERC-20 path");
    }

    /// The same twenty real collections, against the guard as v12 shipped it. If this passed, the fix would
    /// be decoration. It does not: with amounts that are not live token ids -- which is every amount someone
    /// types when they mean "one token" -- the one-probe guard lets every single one of them through.
    function test_the_v12_guard_let_every_one_of_them_through() public {
        address[20] memory a = _nfts();
        uint256 gotThrough;
        for (uint256 i; i < a.length; i++) {
            try g.checkNotNft_v12(a[i], 1e18) { gotThrough++; } catch {}
        }
        emit log_named_uint("real collections v12 would have let into the ERC-20 path", gotThrough);
        assertEq(gotThrough, a.length, "v12 was not as broken as the finding says; check the finding");
    }

    /// And the regression that would matter more than the bug: every real ERC-20 must still be ACCEPTED.
    /// A guard that refuses everything is not a guard, it is an outage.
    function test_no_real_erc20_is_wrongly_refused() public {
        address[20] memory a = _tokens();
        uint256 ok;
        for (uint256 i; i < a.length; i++) {
            try g.checkNotNft(a[i], 1e18, 2e18) { ok++; }
            catch { emit log_named_address("wrongly refused", a[i]); }
        }
        emit log_named_uint("real ERC-20 tokens accepted", ok);
        assertEq(ok, a.length, "a real token was refused as an NFT");
    }

    /// The other direction, on the same real contracts: every real ERC-721 must be ACCEPTED by the NFT path.
    function test_every_real_nft_is_accepted_by_the_nft_guard() public {
        address[20] memory a = _nfts();
        uint256 ok;
        for (uint256 i; i < a.length; i++) {
            try g.checkIsNft(a[i], 1, 2) { ok++; }
            catch { emit log_named_address("real collection refused by _mustBeNft", a[i]); }
        }
        emit log_named_uint("real ERC-721 collections accepted", ok);
        assertEq(ok, a.length, "a real collection was refused by the NFT path");
    }
}
