import { BITBOX } from 'bitbox-sdk';
import { stringify } from '@bitauth/libauth';
import {
  Contract,
  SignatureTemplate,
  ElectrumNetworkProvider,
  CashCompiler,
  Utxo,
} from 'cashscript';
import path from 'path';

const slpMdm = require('slp-mdm');

const toSlp = (txn: any, tokenID: Buffer|string, version: number, receivers: { to: string, amount: bigint}[], from: Utxo[]): any => {

  // checks
  if (version > 255) {
    throw Error("slp version larger than 255 is not currently supported");
  }
  if (tokenID.length != 32) {
    throw Error("slp token id is incorrect size");
  }

  // add p2sh inputs
  from.forEach(f => txn.from(f));

  // build the slp op_return message
  const ver = Buffer.alloc(1);
  ver.writeUInt8(version, 0);
  const amts = Buffer.alloc(receivers.length + 8*receivers.length);
  receivers.forEach((rec, i) => { 
    amts.write("08", 9 * i, "hex");
    amts.writeBigUInt64BE(rec.amount, (9 * i + 1));
  });
  const slpMsg = Buffer.from(`6a04534c500001${ver.toString('hex')}0453454e4420${tokenID.toString('hex')}${amts.toString('hex')}`, 'hex');
  
  // add the slp op_return message
  txn.outputs.unshift({ to: slpMsg, amount: 0 });

  if (txn.outputs.length != 1) {
    throw Error("cannot add other outputs before using slpSend()");
  }

  // add the receiver dust outputs
  receivers.forEach((r, _) => {
    txn.to(r.to, 546);
  });

  return txn;
};

run();
async function run(): Promise<void> {
  // Initialise BITBOX
  const bitbox = new BITBOX();

  // Initialise HD node and alice's keypair
  const rootSeed = bitbox.Mnemonic.toSeed('CashScript');
  const hdNode = bitbox.HDNode.fromSeed(rootSeed, "testnet");
  const alice = bitbox.HDNode.toKeyPair(bitbox.HDNode.derive(hdNode, 0));

  // Derive alice's public key and public key hash
  const alicePk = bitbox.ECPair.toPublicKey(alice);
  const alicePkh = bitbox.Crypto.hash160(alicePk);

  // normal p2pkh address
  const aliceP2pkh = bitbox.Address.hash160ToCash(alicePkh.toString('hex'), 0x6f);
  console.log('p2pkh address:', aliceP2pkh);
  console.log('private key:', alice.toWIF());

  // Read the SLP Vault contract to an artifact object
  const artifact = CashCompiler.compileFile(path.join(__dirname, 'slp_vault.cash'));

  // Initialise a network provider for network operations on TESTNET
  const provider = new ElectrumNetworkProvider('testnet');

  // Instantiate a new contract using the compiled artifact and network provider
  // AND providing the constructor parameters (pkh: alicePkh)
  const contract = new Contract(artifact, [alicePkh], provider);

  // Get contract balance & output address + balance
  console.log('contract address:', contract.address);
  console.log('contract balance:', await contract.getBalance());

  const p2pkhCoin = (await provider.getUtxos(aliceP2pkh))
                      .sort((a, b) => a.satoshis - b.satoshis)
                      .filter((a, b) => a.satoshis > 1000)[0];

  console.log(`p2pkh input used for fee: ${p2pkhCoin.satoshis} sats`);

  const p2shCoin = (await provider.getUtxos(contract.address))[0];

  const tokenID = Buffer.from("3c346636ec989568854d4d74e6352a756702962c5facaec75cb51f32fb5dde91", "hex");
  const slpBuffer = slpMdm.TokenType1.send(tokenID, [ new slpMdm.BN("1") ]);

  // mock txn in order to extract the hashOutputs preimage
  let mockTx = contract.functions.sweep("00", alicePk, new SignatureTemplate(alice))
  mockTx = toSlp(mockTx, tokenID, 1, [{ to: aliceP2pkh, amount: BigInt(1) }], [p2shCoin]);
  await mockTx.experimentalFromP2PKH(p2pkhCoin, new SignatureTemplate(alice))
              .withoutChange()
  const mockTxHex = await mockTx.build();

  const outputsPreimage = mockTxHex.slice(mockTxHex.length - (8 + 1 + slpBuffer.length)*2 -(8 + 1 + 25 + 4)*2, mockTxHex.length - 8);
  
  // Call the sweep() function with alice's signature + pk
  // And use it to send 0. 000 100 00 BCH back to the contract's address
  let tx = contract.functions.sweep(outputsPreimage, alicePk, new SignatureTemplate(alice));
  tx = toSlp(tx, tokenID, 1, [{ to: aliceP2pkh, amount: BigInt(1) }], [p2shCoin]);
  await tx.experimentalFromP2PKH(p2pkhCoin, new SignatureTemplate(alice))
          .withoutChange()
          .send();

  console.log('transaction details:', stringify(tx));

}
