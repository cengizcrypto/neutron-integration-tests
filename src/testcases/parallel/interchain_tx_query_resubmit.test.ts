import {
  cosmosWrapper,
  COSMOS_DENOM,
  icq,
  NEUTRON_DENOM,
  TestStateLocalCosmosTestNet,
  types,
} from 'neutronjs';

const config = require('../../config.json');

describe('Neutron / Interchain TX Query Resubmit', () => {
  let testState: TestStateLocalCosmosTestNet;
  let neutronChain: cosmosWrapper.CosmosWrapper;
  let gaiaChain: cosmosWrapper.CosmosWrapper;
  let neutronAccount: cosmosWrapper.WalletWrapper;
  let gaiaAccount: cosmosWrapper.WalletWrapper;
  let contractAddress: string;
  const connectionId = 'connection-0';

  beforeAll(async () => {
    testState = new TestStateLocalCosmosTestNet(config);
    await testState.init();
    neutronChain = new cosmosWrapper.CosmosWrapper(
      testState.sdk1,
      testState.blockWaiter1,
      NEUTRON_DENOM,
    );
    neutronAccount = new cosmosWrapper.WalletWrapper(
      neutronChain,
      testState.wallets.qaNeutron.genQaWal1,
    );
    gaiaChain = new cosmosWrapper.CosmosWrapper(
      testState.sdk2,
      testState.blockWaiter2,
      COSMOS_DENOM,
    );
    gaiaAccount = new cosmosWrapper.WalletWrapper(
      gaiaChain,
      testState.wallets.qaCosmos.genQaWal1,
    );
  });

  describe('deploy contract', () => {
    let codeId: types.CodeId;
    test('store contract', async () => {
      codeId = await neutronAccount.storeWasm(
        types.NeutronContract.INTERCHAIN_QUERIES,
      );
      expect(codeId).toBeGreaterThan(0);
    });
    test('instantiate contract', async () => {
      contractAddress = (
        await neutronAccount.instantiateContract(
          codeId,
          '{}',
          'neutron_interchain_queries',
        )
      )[0]._contract_address;
    });
  });

  describe('prepare ICQ for failing', () => {
    test('enable mock', async () => {
      await neutronAccount.executeContract(
        contractAddress,
        JSON.stringify({
          integration_tests_set_query_mock: {},
        }),
      );
    });
  });

  const addrFirst = 'cosmos1fj6yqrkpw6fmp7f7jhj57dujfpwal4m2sj5tcp';
  const expectedIncomingTransfers = 5;
  const amountToAddrFirst1 = 10000;
  const watchedAddr1: string = addrFirst;
  const query1UpdatePeriod = 4;

  describe('utilise single transfers query', () => {
    test('register transfers query', async () => {
      // Top up contract address before running query
      await neutronAccount.msgSend(contractAddress, '1000000');
      await icq.registerTransfersQuery(
        neutronAccount,
        contractAddress,
        connectionId,
        query1UpdatePeriod,
        watchedAddr1,
      );
    });

    test('check registered transfers query', async () => {
      const query = await icq.getRegisteredQuery(
        neutronChain,
        contractAddress,
        1,
      );
      expect(query.registered_query.id).toEqual(1);
      expect(query.registered_query.owner).toEqual(contractAddress);
      expect(query.registered_query.keys.length).toEqual(0);
      expect(query.registered_query.query_type).toEqual('tx');
      expect(query.registered_query.transactions_filter).toEqual(
        '[{"field":"transfer.recipient","op":"Eq","value":"' +
          watchedAddr1 +
          '"}]',
      );
      expect(query.registered_query.connection_id).toEqual(connectionId);
      expect(query.registered_query.update_period).toEqual(query1UpdatePeriod);
    });

    test('check failed txs', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await gaiaAccount.msgSend(
          watchedAddr1,
          amountToAddrFirst1.toString(),
        );
        expect(res.code).toEqual(0);
      }

      await neutronChain.blockWaiter.waitBlocks(5);

      const txs = await icq.getUnsuccessfulTxs(testState.icq_web_host);
      expect(txs.length).toEqual(5);
    });

    test('resubmit failed tx', async () => {
      await neutronAccount.executeContract(
        contractAddress,
        JSON.stringify({
          integration_tests_unset_query_mock: {},
        }),
      );

      const resubmitTxs = (
        await icq.getUnsuccessfulTxs(testState.icq_web_host)
      ).map((tx) => ({ query_id: tx.query_id, hash: tx.submitted_tx_hash }));
      const resp = await icq.postResubmitTxs(
        testState.icq_web_host,
        resubmitTxs,
      );
      expect(resp.status).toEqual(200);

      await neutronChain.blockWaiter.waitBlocks(20);

      await icq.waitForTransfersAmount(
        neutronChain,
        contractAddress,
        expectedIncomingTransfers,
        query1UpdatePeriod * 2,
      );

      const txs = await icq.getUnsuccessfulTxs(testState.icq_web_host);
      expect(txs.length).toEqual(0);

      const deposits = await icq.queryRecipientTxs(
        neutronChain,
        contractAddress,
        watchedAddr1,
      );
      expect(deposits.transfers.length).toEqual(5);
    });

    test('resubmit nonexistent failed tx', async () => {
      await expect(
        icq
          .postResubmitTxs(testState.icq_web_host, [
            { query_id: 1, hash: 'nonexistent' },
          ])
          .catch((e) => {
            throw new Error(e.response.data);
          }),
      ).rejects.toThrow('no tx found with queryID=1 and hash=nonexistent');
    });
  });
});
