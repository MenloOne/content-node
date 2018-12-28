import { Injectable } from '@nestjs/common'
import web3           from './services/W3'
import { Topics } from './services/Topics'
import { ForumCTOGet, MessageCTOPost, TopicCTOPost, TopicsCTOGet } from './ContentNode/BlockOverflow.cto'
import NotificationsGateway from './notifications.gateway'

@Injectable()
export class AppService {

    private _topics: Topics;

    constructor(private readonly notifications: NotificationsGateway) {
        this._topics = new Topics(this.notifications)
        this.connectToBlockchain()
    }

    async connectToBlockchain() {
        console.log('----------- CONNECTING TO BLOCKCHAIN --------------')
        await web3.unlocked

        await this._topics.connectToBlockchain()
        await this._topics.synced

        console.log('----------- SERVICE SYNCED AND READY FOR QUERIES --------------')
    }

    async version(): Promise<string> {
        await web3.unlocked

        return `Web3 version ${web3.version.api}`
    }

    async topicsNext(continuation: string): Promise<TopicsCTOGet> {
        await Promise.all([web3.unlocked, this._topics.synced])
        return this._topics.modelGETNext(continuation)
    }

    async topics(query: string | null = null, pageLimit: number | undefined = undefined ): Promise<TopicsCTOGet> {
        await Promise.all([web3.unlocked, this._topics.synced])
        return this._topics.modelGET(query, pageLimit);
    }

    async createTopic(topic: TopicCTOPost) : Promise<void> {
        await Promise.all([web3.unlocked, this._topics.synced])
        this._topics.addTopic(topic)
    }

    async forum(address: string): Promise<ForumCTOGet> {
        await Promise.all([web3.unlocked, this._topics.synced])

        const topic = this._topics.getTopic(address)
        console.log(`GET for Topic: ${address} == ${topic.forumAddress}: ${topic.title}`)
        return topic.forum!.modelGET()
    }

    async createMessage(address: string, message: MessageCTOPost): Promise<void> {
        await Promise.all([web3.unlocked, this._topics.synced])

        const topic = this._topics.getTopic(address)
        topic.forum!.addMessage(message)
    }
}
