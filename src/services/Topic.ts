import { Topics } from "./Topics";
import { IPFSTopic } from "../storage/RemoteIPFSStorage";
import { Forum } from './Forum'
import { MessageCTOGet, TopicCTOGet, TopicCTOPost } from '../ContentNode/BlockOverflow.cto'


export default class Topic extends IPFSTopic {

    private TOPIC_LENGTH_SECONDS : number = 24 * 60 * 60

    public topics: Topics

    public forum: Forum | null = null
    public forumAddress: string | undefined | null
    public offset: number

    public messageHash: string
    public body: string
    public ethTransaction: string | null

    public confirmed: boolean
    public filled: boolean

    public endTime: number

    error: Error | null = null

    constructor(topics : Topics, topic: TopicCTOPost | null, offset : number, forumAddress?: string, messageHash?: string) {
        super()

        this.topics = topics
        this.offset = offset

        if (topic) {
            this.forumAddress = topic.forumAddress

            this.messageHash = topic.messageHash

            // IPFSTopic
            this.version = topic.version
            this.offset  = topic.offset
            this.author  = topic.author
            this.date    = topic.date
            this.title   = topic.title
            this.body    = topic.body
            this.confirmed = topic.confirmed
            this.ethTransaction = topic.transaction

            this.filled = true
        } else {
            this.ethTransaction = null
            this.forumAddress = forumAddress
            this.offset = offset
            this.messageHash = messageHash!
            this.confirmed = true
            this.filled = false
            this.body = 'Loading from IPFS...'
        }

        this.refresh = this.refresh.bind(this)
    }

    modelGET() : TopicCTOGet {
        // Will need way of specifying subset of info that comes from pointed to contract
        // or a subset that shouldn't be included like messages[]
        const forum : { pool: number, winningVotes: number, endTime: number, totalAnswers: number, winningMessage: MessageCTOGet | null } = {
            pool:           0,
            winningVotes:   0,
            totalAnswers:   0,
            endTime:        0,
            winningMessage: null
        }

        let claimed = false

        if (this.forum) {
            forum.pool = this.forum.pool
            forum.winningVotes = this.forum.winningVotes
            forum.totalAnswers = this.forum.postCount - 1
            forum.endTime = this.forum.endTimestamp
            claimed = (this.forum.bounty === 0)

            const message = this.forum.messages.get(this.forum.messageHashes[this.forum.winningOffset])
            forum.winningMessage = message ? message.modelGET() : null
        } else {
            forum.endTime = (new Date().getTime() + this.TOPIC_LENGTH_SECONDS * 1000) / 1000
        }

        return {
            version:      this.version,
            offset:       this.offset,
            author:       this.author,
            date:         this.date,
            messageHash:  this.messageHash,
            title:        this.title,
            body:         this.body,
            isClaimed:    claimed,
            forumAddress: this.forumAddress,
            confirmed:    this.confirmed,
            transaction:  this.ethTransaction,
            ...forum,
        }
    }

    public get id(): string {
        return this.forumAddress ? this.forumAddress : this.ethTransaction!
    }

    async refresh() {
        await this.fillTopic()
    }

    async fillTopic() {
        await this.topics.ready

        try {
            console.log(`[[ Fill Topic ]] ( ${this.offset} ) ${this.messageHash}`)

            // Grab data from the actual Forum contract
            if (!this.forum) {

                if (this.forumAddress) {
                    this.forum = new Forum(this.forumAddress, this.topics.notifications)
                    await this.forum.initContract()

                    Object.assign(this, this.forum.topic);
                } else {
                    console.log('No forum address?')
                }
            }

            this.error  = null
            this.filled = true
        } catch (e) {
            console.log(`Couldn't fill topic ${this.forumAddress}`)
            this.error = e

        } finally {
            this.topics.onModifiedTopic(this)
        }
    }
}

