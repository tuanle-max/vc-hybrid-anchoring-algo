import algosdk from 'algosdk';

const account = algosdk.generateAccount();
const mnemonic = algosdk.secretKeyToMnemonic(account.sk);

console.log("=== NEW ALGORAND ACCOUNT GENERATED ===");
console.log(`Public Address: ${account.addr}`);
console.log(`Mnemonic:       ${mnemonic}`);
console.log("======================================");
console.log("Please fund this Mainnet wallet manually before proceeding.");
