import { BITBOX } from 'bitbox-sdk';
import { stringify } from '@bitauth/libauth';
import {
  Contract,
  SignatureTemplate,
  ElectrumNetworkProvider,
  Artifact,
} from 'cashscript';
import { readFileSync } from 'fs';

run();
async function run(): Promise<void> {
  // Initialise BITBOX
  const bitbox = new BITBOX();

  // Initialise HD node and alice's keypair
  const rootSeed = bitbox.Mnemonic.toSeed('CashScript');
  const hdNode = bitbox.HDNode.fromSeed(rootSeed, "testnet");
  const alice = bitbox.HDNode.toKeyPair(bitbox.HDNode.derive(hdNode, 0));
  console.log('private key:', alice.toWIF());

  // Derive alice's public key and public key hash
  const alicePk = bitbox.ECPair.toPublicKey(alice);
  const alicePkh = bitbox.Crypto.hash160(alicePk);

  // normal p2pkh address
  const aliceP2pkh = bitbox.Address.hash160ToCash(alicePkh.toString('hex'), 0x6f);
  console.log('p2pkh address:', aliceP2pkh);

  // Read the SLP Vault contract to an artifact object
  const artifact = JSON.parse(Buffer.from(readFileSync('./slp_vault.artifact')).toString("utf8")) as Artifact;

  // Initialise a network provider for network operations on TESTNET
  const provider = new ElectrumNetworkProvider('testnet');

  // Instantiate a new contract using the compiled artifact and network provider
  // AND providing the constructor parameters (pkh: alicePkh)
  const contract = new Contract(artifact, [alicePkh], provider);

  // Get contract balance & output address + balance
  console.log('contract address:', contract.address);
  console.log('contract balance:', await contract.getBalance());

  const p2pkhCoins = (await provider.getUtxos(aliceP2pkh)).sort((a, b) => a.satoshis - b.satoshis);
  console.log(`spending ${p2pkhCoins[0]} sats`);
  const p2shCoins = await provider.getUtxos(contract.address);

  const tokenID = Buffer.from("3c346636ec989568854d4d74e6352a756702962c5facaec75cb51f32fb5dde91", "hex");

  // mock txn in order to extract the hashOutputs preimage
  const mockTx = contract.functions
    .sweep("00", alicePk, new SignatureTemplate(alice))
    .toSlp(tokenID, 1, [{ to: aliceP2pkh, amount: BigInt(1) }], p2shCoins)
    .experimentalFromP2PKH(p2pkhCoins[0], alicePk)
    .withoutChange();
  const mockTxHex = await mockTx.build();
  const outputsPreimage = mockTxHex.slice(mockTxHex.length - (8 + 1 + 25 + 4)*2, mockTxHex.length - 8);
  
  // Call the sweep() function with alice's signature + pk
  // And use it to send 0. 000 100 00 BCH back to the contract's address
  const tx = await contract.functions
    .sweep(outputsPreimage, alicePk, new SignatureTemplate(alice))
    .toSlp(tokenID, 1, [{ to: aliceP2pkh, amount: BigInt(1) }], p2shCoins)
    .experimentalFromP2PKH(p2pkhCoins[0], alicePk)
    .send();

  console.log('transaction details:', stringify(tx));

  // // Call the spend() function with alice's signature + pk
  // // And use it to send two outputs of 0. 000 150 00 BCH back to the contract's address
  // const tx2 = await contract.functions
  //   .sweep(alicePk, new SignatureTemplate(alice))
  //   .to(aliceP2pkh, 1000)
  //   .send();

  // console.log('transaction details:', stringify(tx2));
}
