import axios from 'axios';
import { execSync } from 'child_process';
import { wait } from './wait';

const BLOCKS_COUNT_BEFORE_START = process.env.BLOCKS_COUNT_BEFORE_START
  ? parseInt(process.env.BLOCKS_COUNT_BEFORE_START, 10)
  : 10;

let alreadySetUp = false;

export const setup = async (host: string) => {
  if (alreadySetUp) {
    console.log('already set up');
    return;
  }
  if (process.env.NO_DOCKER) {
    console.log('NO_DOCKER ENV provided');
    return;
  }
  try {
    execSync(`cd setup && make stop-cosmopark`);
    // eslint-disable-next-line no-empty
  } catch (e) {}
  console.log('Starting container... it may take long');
  execSync(`cd setup && make start-cosmopark`);
  showVersions();
  await waitForHTTP(host);
  await waitForChannel(host);
  alreadySetUp = true;
};

export const waitForHTTP = async (
  host = 'http://127.0.0.1:1317',
  path = `blocks/${BLOCKS_COUNT_BEFORE_START}`,
  timeout = 280000,
) => {
  const start = Date.now();
  while (Date.now() < start + timeout) {
    try {
      const r = await axios.get(`${host}/${path}`, {
        timeout: 1000,
      });
      if (r.status === 200) {
        return;
      }
      // eslint-disable-next-line no-empty
    } catch (e) {}
    await wait(10);
  }
  throw new Error('No port opened');
};

export const waitForChannel = async (
  host = 'http://127.0.0.1:1317',
  timeout = 100000,
) => {
  const start = Date.now();

  while (Date.now() < start + timeout) {
    try {
      const r = await axios.get(`${host}/ibc/core/channel/v1/channels`, {
        timeout: 1000,
      });
      if (r.data.channels.length > 0) {
        return;
      }
      // eslint-disable-next-line no-empty
    } catch (e) {}
    await wait(10);
  }
  throw new Error('No channel opened');
};

export const showVersions = () => {
  if (process.env.NO_DOCKER) {
    console.log('Cannot get versions since NO_DOCKER ENV provided');
    return;
  }
  const servicesAndGetVersionCommands = [
    [
      'neutrond',
      'cd setup && docker compose exec neutron-node /go/bin/neutrond version',
    ],
    [
      'ICQ relayer',
      'cd setup && docker compose exec relayer neutron_query_relayer version',
    ],
    ['gaiad', 'cd setup && docker compose exec gaia-node gaiad version 2>&1'],
    ['hermes', 'cd setup && docker compose exec hermes hermes version'],
    ['Integration tests', "git log -1 --format='%H'"],
  ];
  for (const service of servicesAndGetVersionCommands) {
    try {
      const version = execSync(service[1]).toString().trim();
      console.log(`${service[0]} version:\n${version}`);
    } catch (err) {
      console.log(`Cannot get ${service[0]} version:\n${err}`);
    }
  }
};
