import * as uuid from 'uuid';
import * as machineId from 'node-machine-id';
import { W3 } from 'soltsice'
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from '../utils/promisify';
import { ContractAddresses, networks } from './networks';
import Web3 from 'web3'

const V0_WEB3_URL = 'http://localhost:8545' // https://mainnet.infura.io/v3/1b81fcc6e29d459ca28861e0901aba99'
const V1_WEB3_URL = 'ws://localhost:8546'

export class Web3V0 extends W3 {

    /** Set in on startup from config */

    public botAddress: string = '0xEADf4eECEdE7E07a1Bb53510CBd1ACE191B2Fd7f'.toLowerCase();
    public contractAddresses: ContractAddresses;
    public unlocked: Promise<boolean>;

    constructor(provider: W3.Provider) {
        super(provider);

        // this.unlocked = this.unlock(150000);

        try {
            this.contractAddresses = networks[this.web3.version.network]
        } catch (e) {
            throw `No local Ethereum node found at ${V0_WEB3_URL}`
        }
    }

    public generateUuid(): string {
        return uuid.v4();
    }

    /*
    private getMachineUniqueId(): string {
        return machineId.machineIdSync();
    }
    */

    private async getSecretMachineId() {

        return "password"
        /*
        // this could be the same for same virtual images, add locally stored uuid for security
        const mId = this.getMachineUniqueId();
        const filepath = path.join(__dirname, '../../machine.key');
        if (fs.existsSync(filepath)) {
            return mId + fs.readFileSync(filepath, {encoding: 'ascii'});
        }
        const id = this.generateUuid();
        fs.writeFileSync(filepath, id, {encoding: 'ascii'});
        return mId + id;
        */
    }

    public async getBotAddress(): Promise<string> {
        if (this.botAddress && !(await this.isTestRPC)) {
            return this.botAddress;
        }

        const netId = await this.networkId;
        const pass = await this.getSecretMachineId();
        let address;
        const filepath = path.join(__dirname, `../../machine.account.${netId}.address`);

        const createNew = async (): Promise<string> => {
            const addr = await promisify(this.web3.personal.newAccount, pass);
            if (!W3.isValidAddress(addr)) {
                throw new Error('Cannot create new account');
            }
            fs.writeFileSync(filepath, addr, { encoding: 'ascii' });
            return addr;
        };

        if (fs.existsSync(filepath)) {
            address = fs.readFileSync(filepath, { encoding: 'ascii' });
            const accs = await this.accounts;
            if (!accs.includes(address) && await this.isTestRPC) {
                // for TestRPC restarts
                address = await createNew();
            }
        } else {
            address = await createNew();
        }

        const accounts = await this.accounts;

        if (!accounts.includes(address)) {
            throw new Error('New account is not listed in accounts list');
        }

        this.botAddress = address;

        // const pers = w3.personal
        return address;
    }

    /** This is slow (more than a second).
     * Should unlock for a long time for the bot. If the server is hacked timeout won't help.
     * TODO good case for bug bounty - to access bot private key
     */
    public async unlock(seconds: number): Promise<boolean> {
        const address = this.botAddress // || await this.getBotAddress();
        const pwd = await this.getSecretMachineId()
        const result = await this.unlockAccount(address, pwd);

        console.log(`${result ? 'Able' : 'UNABLE'} to unlock bot address`)
        return result;
    }

    public getGenesisAddress(): string {
        return machineId.machineIdSync();
    }
}

export const web3v1 = new Web3(new Web3.providers.WebsocketProvider(V1_WEB3_URL))
const web3 = new Web3V0(new Web3V0.providers.HttpProvider(V0_WEB3_URL));

export default web3;

