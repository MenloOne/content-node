/*
 * Copyright 2018 Menlo One, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import w3, { web3v1 } from './W3'
import MessagesGraph from './MessageGraph'

import RemoteIPFSStorage, { IPFSTopic } from '../storage/RemoteIPFSStorage'
import HashUtils, { CIDZero, SolidityHash, solidityHashToCid } from '../storage/HashUtils'

import { QPromise } from '../utils/QPromise'

import * as MenloForumJSON from '../artifacts/MenloForum.json'
import * as MenloTokenJSON from '../artifacts/MenloToken.json'
import { MenloForum } from '../contracts/MenloForum'
import { MenloToken } from '../contracts/MenloToken'

import Message from './Message'
import { CID, ForumCTOGet, MessageCTOPost } from '../ContentNode/BlockOverflow.cto'
import NotificationsGateway from '../notifications.gateway'
import { Log } from 'web3/types'


export class Forum {

    // Private

    public contractAddress: string
    public contract: MenloForum | null = null
    public tokenContract: MenloToken | null = null

    private signalReady: () => void
    private signalSynced: () => void

    // Public

    public ready: any
    public synced: any

    public topicHash: string
    public topic: IPFSTopic

    public messages: MessagesGraph
    public epochLength: number

    private ACTION_POST: number
    private ACTION_UPVOTE: number
    private ACTION_DOWNVOTE: number

    // public account: string | null
    public remoteStorage: RemoteIPFSStorage

    public filledMessagesCounter: number
    public messageOffsets: Map<CID, number> | {}
    public messageHashes: string[]
    private unconfirmedMessages: Message[] = []

    public postCount : number
    public postCost : number
    public voteCost : number
    public endTimestamp: number = 0

    public  author: string = ''
    public  pool: number = 0
    public  bounty: number = 0
    public  claimed: boolean = false

    public  winningVotes: number
    public  winningOffset: number

    private notifications: NotificationsGateway


    constructor( forumAddress: string, notifications: NotificationsGateway ) {
        this.ready  = QPromise((resolve) => { this.signalReady = resolve })
        this.synced = QPromise((resolve) => { this.signalSynced = resolve })

        this.contractAddress = forumAddress
        this.remoteStorage = new RemoteIPFSStorage()
        this.notifications = notifications
    }

    async initContract() {
        if (!this.tokenContract) {
            this.tokenContract = new web3v1.eth.Contract(MenloTokenJSON.abi, w3.contractAddresses.MenloToken) as unknown as MenloToken
        }

        if (!this.contract) {
            this.contract = new web3v1.eth.Contract(MenloForumJSON.abi, this.contractAddress) as unknown as MenloForum
        }


        await this.readContract()

        // Prep messages cache
        this.messages = new MessagesGraph(new Message(this, null, CIDZero, CIDZero, 0))
        this.filledMessagesCounter = 0
        this.messageOffsets = {}
        this.messageHashes = []

        // Read set of comments votes etc
        // This is based on events because the contract uses events as an array of events
        // instead of an array in the contract itself
        this.watchForAnswers()
        this.watchForVotes()
        this.watchForComments()
        this.watchForPayouts()
        this.watchForTransactions()

        console.log(`Forum ${this.contractAddress} READY`)
        this.signalReady()

        if (this.postCount <= 1) {
            // console.log(`Forum ${this.contractAddress} SYNCED - HAS NO ANSWERS`)
            this.signalSynced()
        }
    }

    private async readContract() {
        try {
            const contract = this.contract!;

            // String values
            [
                this.author,
                this.topicHash
            ] = await Promise.all([
                contract.methods.author().call(),
                contract.methods.topicHash().call(),
            ]);

            // Numbers
            [
                this.ACTION_POST,
                this.ACTION_UPVOTE,
                this.ACTION_DOWNVOTE,
                this.postCount,
                this.epochLength,
                this.postCost,
                this.voteCost,
                this.pool,
                this.endTimestamp,
                this.winningVotes,
                this.winningOffset
            ] = (await Promise.all([
                contract.methods.ACTION_POST().call(),
                contract.methods.ACTION_UPVOTE().call(),
                contract.methods.ACTION_DOWNVOTE().call(),
                contract.methods.postCount().call(),
                contract.methods.epochLength().call(),
                contract.methods.postCost().call(),
                contract.methods.voteCost().call(),
                contract.methods.pool().call(),
                contract.methods.endTimestamp().call(),
                contract.methods.winningVotes().call(),
                contract.methods.winningOffset().call(),
            ])).map(n => parseInt(n, 10));

            this.bounty = parseInt(await this.tokenContract!.methods.balanceOf(this.contractAddress).call({}), 10)

            // Do IPFS get at the end in case it fails
            if (!this.topic) {
                this.topic = await this.remoteStorage.getMessage<IPFSTopic>(HashUtils.solidityHashToCid(this.topicHash as SolidityHash));
            }

        } catch (e) {
            console.error('Unable to fill ready Forum: ', e)
        }
    }


    modelGET() : ForumCTOGet {
        // Account specific queries
        const messages = this.messages.get(CIDZero).modelGET()
        messages.children = messages.children.concat(this.unconfirmedMessages.map( m => m.modelGET()))

        return {
            topic:          this.topic,
            voteCost:       this.voteCost,
            postCost:       this.postCost,
            epochLength:    this.epochLength,
            postCount:      this.postCount,
            messageHashes:  this.messageHashes,
            messageOffsets: this.messageOffsets,
            endTimestamp:   this.endTimestamp,
            author:         this.author,
            pool:           this.pool,
            claimed:        this.claimed,
            winningVotes:   this.winningVotes,
            winningOffset:  this.winningOffset,
            ACTION_POST:    this.ACTION_POST,
            ACTION_UPVOTE:  this.ACTION_UPVOTE,
            ACTION_DOWNVOTE:this.ACTION_DOWNVOTE,
            messages,
        }
    }

    markClaimed() {
        this.claimed = true
    }

    topicOffset(id : string) {
        return this.messageOffsets[id]
    }

    async watchForPayouts() {
        await this.synced
        const forum = this.contract!

        forum.events.Payout({ fromBlock: 0 }, async (error, result) => {
            if (error) {
                console.error(error)
                return
            }

            const payout: { tokens: number, user: string } = {
                tokens: parseInt(result.returnValues['_tokens'], 10),
                user:   result.returnValues['_user']
            }
            console.log('[[ Payout ]] ', payout)

            this.markClaimed()
            this.readContract()
        })
    }

    async watchForVotes() {
        await this.synced
        const forum = this.contract!

        forum.events.Vote({ fromBlock: 0 }, async (error, result) => {
            if (error) {
                console.error( error )
                return
            }

            const offset    = parseInt(result.returnValues['_offset'], 10)
            const direction = parseInt(result.returnValues['_direction'], 10)

            console.log(`[[ Vote ]] ( ${offset} ) > ${direction}` )

            const message = this.messages.get(this.messageHashes[offset])
            if (message) {
                await this.incrementVotes(message, 0)
            }

            this.readContract()
        })
    }

    async watchForTransactions() {
        web3v1.eth.subscribe('logs', {}, (error, log) => {
            if (error) {
                console.error('ERROR! ', error)
                return
            }

            const l = log as any as Log

            let matchedIndex: number = 0
            const matchedTopics = this.unconfirmedMessages.filter((t, i) => {
                if (t.ethTransaction === l.transactionHash) {
                    matchedIndex = i
                    return true
                }
                return false
            })

            if (matchedTopics.length > 0) {
                console.log('[[ Matched Pending Message Transaction ]] ', l)
                this.unconfirmedMessages.splice(matchedIndex, 1)
            }
        })
    }


    async watchForAnswers() {
        await this.ready
        const forum = this.contract!

        forum.events.Answer({ fromBlock: 0 }, async (error, result) => {
            if (error) {
                console.error( error )
                return
            }

            const messageHash : SolidityHash = result.returnValues['_contentHash']
            const messageID : CID = solidityHashToCid(messageHash)

            if (messageID === CIDZero) {
                // console.log(`[[ Answer ]] ${messageHash}`)

                // Probably 0x0 > 0x0 which Solidity adds to make life simple
                this.messageOffsets[messageID] = this.messageHashes.length
                this.messageHashes.push(messageID)
                return
            }

            if (typeof this.messageOffsets[messageID] === 'undefined') {
                const offset = this.messageHashes.length
                console.log(`[[ Answer ]] ( ${offset} ) ${messageID}`)

                this.messageOffsets[messageID] = offset
                this.messageHashes.push(messageID)
                const message = new Message( this, null, messageID, CIDZero, offset )

                this.messages.add(message)
                await this.fillMessage(message.id)

                this.readContract()
            }
        })
    }

    async watchForComments() {
        await this.synced
        const forum = this.contract!

        forum.events.Comment({ fromBlock: 0 }, (error, result) => {
            if (error) {
                console.error( error )
                return
            }

            const parentHash  : SolidityHash = result.returnValues['_parentHash']
            const messageHash : SolidityHash = result.returnValues['_contentHash']

            const parentID  = HashUtils.solidityHashToCid(parentHash)
            const messageID = HashUtils.solidityHashToCid(messageHash)

            console.log(`[[ Comment ]] ${parentID} > ${messageID}`)
            const message = new Message( this, null, messageID, parentID, -1 )

            this.messages.add(message)
            this.fillMessage(message.id)

            this.readContract()
        })
    }

    async fillMessage(id : string) {
        await this.ready;

        const message = this.messages.get(id)
        if (!message) {
            throw (new Error(`Unable to get message ${id}`))
        }

        try {
            if (message.parent === CIDZero) {
                await this.incrementVotes(message, 0)
            }

            Object.assign(message, await this.remoteStorage.getMessage(message.id))
            message.filled = true
        } catch (e) {
            console.log('Error filling Message ', message.id, ' Error ', e)

            if (!message.error) {
                setTimeout(() => { this.fillMessage(message.id) }, 100)
            } else {
                this.messages.delete(message)
            }

            // Couldn't fill message, retry
            console.error(e)

            message.error = e
            message.body = 'IPFS Retrieval Issue. Retrying...'
        } finally {
            this.filledMessagesCounter++;

            if (this.filledMessagesCounter >= this.postCount - 1) {
                console.log(`Forum ${this.contractAddress} SYNCED`)
                this.signalSynced()
            }

            // console.log('onModified ',message)
            this.onModifiedMessage(message)
        }
    }

    private async incrementVotes(message : Message, delta : number) {
        await this.ready
        const forum = this.contract!

        if (delta) {
            message.votes += delta
        } else {
            if (!message || !message.id) {
                throw (new Error('invalid Topic ID'))
            }
            message.votes = parseInt(await forum.methods.votes(this.topicOffset(message.id)).call(), 10)
        }

        this.onModifiedMessage(message)
        // console.log('updated Votes: ', message)
    }

    onModifiedMessage(message?: Message) {
        // Send message back

        if (this.notifications.server) {
            // this.notifications.server.emit('NewTopic', topic ? topic.modelGET() : null)

            this.notifications.clients.forEach(async client => {
                client.emit('NewMessage', message ? message.modelGET() : null)
            })
        }
    }

    async upvoteAndComment(comment: MessageCTOPost): Promise<Message> {
        return this.addVoteAndComment(comment, 1)
    }

    async downvoteAndComment(comment: MessageCTOPost): Promise<Message> {
        return this.addVoteAndComment(comment, -1)
    }

    async addVoteAndComment(comment: MessageCTOPost, direction: number) : Promise<Message> {
        await this.ready

        // TODO: Should this be different somehow than addMessage?
        return this.addMessage(comment)
    }

    async addMessage(messageModel: MessageCTOPost) : Promise<Message> {
        await this.ready

        const message = new Message( this, messageModel )
        this.unconfirmedMessages.push(message)
        this.onModifiedMessage(message)
        return message
    }

    public removeMessage(id: string) {
        const messages = this.unconfirmedMessages
        for (let i = 0; i < messages.length; i++) {
            if (messages[i].id === id) {
                this.unconfirmedMessages = this.unconfirmedMessages.splice(i, 1)
                this.onModifiedMessage()
            }
        }
    }

}

