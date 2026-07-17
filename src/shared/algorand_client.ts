import algosdk from 'algosdk';

const token = '';
const baseServer = 'https://mainnet-api.algonode.cloud';
const port = '';

export const algodClient = new algosdk.Algodv2(token, baseServer, port);
