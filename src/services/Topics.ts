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

import RemoteIPFSStorage from '../storage/RemoteIPFSStorage'
import HashUtils from '../storage/HashUtils'
import { QPromise } from '../utils/QPromise'

import * as MenloTopicsJSON from '../artifacts/MenloTopics.json'
import * as MenloTokenJSON  from '../artifacts/MenloToken.json'
import { MenloToken } from '../contracts/MenloToken'
import { MenloTopics } from '../contracts/MenloTopics'

import Topic from './Topic'
import { TopicCTOPost, TopicsCTOGet } from '../ContentNode/BlockOverflow.cto'
import NotificationsGateway from '../notifications.gateway'
import { EventLog, Log } from 'web3/types'

interface IQueryScope {
    query: string
    notAfter: number
    pageSize: number
}

export class Topics {

    public ready: any
    public synced: any

    // Private
    public topics: Topic[] = []
    public query: string = ''

    private TOPIC_LENGTH_SECONDS : number = 24 * 60 * 60
    private MAX_UNCONFIRMED_AGE : number = 5 * 60 * 60 * 1000
    private MAX_PAGELENGTH: number = 30

    private signalReady: () => void
    private signalSynced: () => void

    public  tokenContract: MenloToken
    public  contract: MenloTopics | null

    private actions: { newTopic }

    public  remoteStorage: RemoteIPFSStorage

    private initialTopicCount: number
    private filledTopicsCounter: number = 0
    private topicOffsets: Map<string, number> | {}
    private topicHashes: string[]
    private unconfirmedTopics: Topic[] = []
    public notifications: NotificationsGateway

    constructor(_notifications: NotificationsGateway) {
        this.ready  = QPromise((resolve) => { this.signalReady = resolve })
        this.synced = QPromise((resolve) => { this.signalSynced = resolve })

        this.remoteStorage = new RemoteIPFSStorage()
        this.notifications = _notifications
    }

    async connectToBlockchain() {
        try {
            console.log(`MenloToken: ${w3.contractAddresses.MenloToken}`)
            console.log(`MenloTopics: ${w3.contractAddresses.MenloTopics}`)

            this.tokenContract = new web3v1.eth.Contract(MenloTokenJSON.abi, w3.contractAddresses.MenloToken) as unknown as MenloToken
            this.contract = new web3v1.eth.Contract(MenloTopicsJSON.abi, w3.contractAddresses.MenloTopics) as unknown as MenloTopics

            this.topicOffsets = {}
            this.topicHashes = []
            this.initialTopicCount = parseInt(await this.contract.methods.topicsCount().call(), 10)

            const newTopic = parseInt(await this.contract.methods.ACTION_NEWTOPIC().call(), 10)
            this.actions = { newTopic }

            this.watchForTopics()
            this.watchForTransactions()

            this.signalReady()

            if (this.initialTopicCount === 0) {
                this.signalSynced()
            }

        } catch (e) {
            console.error(e)
            throw(e)
        }
    }

    public async modelGETNext(continuation: string) : Promise<TopicsCTOGet> {
        const scope : IQueryScope = JSON.parse( decodeURI(continuation))
        return await this.modelGET(scope.query, scope.pageSize, scope.notAfter)
    }

    modelGET(query: string | null, _pageSize: number = this.MAX_PAGELENGTH, notAfter?: number) : TopicsCTOGet {
        const now = new Date().getTime()
        const pageSize = Math.min(_pageSize, this.MAX_PAGELENGTH)

        let allTopics: Topic[]
        allTopics = this.topics.slice()
        allTopics.forEach(t => t.endTime = t.forum!.endTimestamp)

        // Remove old unconfirmed topics
        this.unconfirmedTopics.forEach( t => {
            if (now - t.date > this.MAX_UNCONFIRMED_AGE) {
                this.removeTopic(t.id)
            }
        })

        const j = allTopics.length
        allTopics = allTopics.concat(this.unconfirmedTopics)
        for (let i = j; i < allTopics.length; i++ ) {
            allTopics[i].endTime = (now + this.TOPIC_LENGTH_SECONDS * 1000) / 1000
        }

        let filteredTopics: Topic[]

        if (!query || query.length === 0) {
            filteredTopics = allTopics
        } else {
            const lowerQuery = query.toLowerCase()
            const pattern = `(${lowerQuery.toLowerCase().split(' ').filter(s => s.length > 0).map(s => `(?=.*${s})`).join('')})`
            const queryRegExp = RegExp(pattern)

            filteredTopics = allTopics.filter(t => queryRegExp.test(t.title.toLowerCase()))
        }

        const total = filteredTopics.length

        filteredTopics.sort((a, b) => b.endTime - a.endTime) // Descending by endTime
        if (notAfter) {
            filteredTopics = filteredTopics.filter(t => t.endTime < notAfter)
        } else {
            filteredTopics = filteredTopics.slice(0, pageSize)
        }

        const topics = filteredTopics.map(t => t.modelGET())

        const continuation : string = encodeURI(JSON.stringify({
            query,
            notAfter: topics.length === 0 ? 0 : topics[topics.length - 1].endTime,
            pageSize
        } as IQueryScope))

        return {
            ACTION_NEWTOPIC: this.actions.newTopic,
            query:           this.query,
            total,
            continuation,
            topics
        }
    }

    async watchForTransactions() {
        return web3v1.eth.subscribe('logs', {}, (error, log) => {
            if (error) {
                console.error('ERROR! ', error)
                return
            }

            const l = log as any as Log

            let matchedIndex: number = 0
            const matchedTopics = this.unconfirmedTopics.filter((t, i) => {
                if (t.ethTransaction === l.transactionHash) {
                    matchedIndex = i
                    return true
                }
                return false
            })

            if (matchedTopics.length > 0) {
                console.log('[[ Matched Pending Transaction ]] ', l)
                this.unconfirmedTopics.splice(matchedIndex, 1)
            } else {
                if (process.env.ENV !== 'production') {
                    // console.log('[[ Transaction ]] ', l.transactionHash)
                }
            }
        })
    }

    async watchForTopics() {
        await this.ready
        const topics = this.contract!

        topics.events.allEvents({ fromBlock:0 }, async (error: Error, result: EventLog) => {
            if (error) {
                console.error( error )
                return
            }

            if (result.event === 'NewTopic') {
                const forumAddress = result.returnValues['_forum']
                const topicHash = HashUtils.solidityHashToCid(result.returnValues['_topicHash'])

                if (typeof this.topicHashes[forumAddress] !== 'undefined') {
                    console.error('Received duplicate Topic! ', forumAddress)
                    return
                }

                const offset = this.topicHashes.length
                console.log(`[[ Topic ]] ( ${offset} ) ${forumAddress}`)

                const topic = await this.addTopic(null, forumAddress, topicHash)

                if (this.filledTopicsCounter >= this.initialTopicCount) {
                    await this.waitForForums()

                    console.log('Topic Forums synced...')
                    this.signalSynced()
                }

                this.onModifiedTopic(topic)
                return
            }

            if (result.event === 'ClosedTopic') {
                // TODO: Determine topic and onModifiedTopic() for it
            }
        })
    }

    public async addTopic( topicModel : TopicCTOPost | null, forumAdddress?: string, topicHash?: string): Promise<Topic> {

        if (topicModel && !topicModel.confirmed) {
            console.log('[[ ADDING UNCONFIRMED TOPIC ]] ', topicModel)
            const topic = new Topic( this, topicModel, this.unconfirmedTopics.length, forumAdddress, topicHash )
            this.unconfirmedTopics.push(topic)
            this.onModifiedTopic(topic)
            return topic
        }

        const offset = this.topicHashes.length

        const topic = new Topic( this, topicModel, offset, forumAdddress, topicHash )
        this.topicOffsets[topic.id] = offset
        this.topicHashes.push(topic.id)

        await topic.fillTopic()
        this.topics.push(topic)

        this.filledTopicsCounter++
        console.log(`Filled topics ${this.filledTopicsCounter} vs ${this.topics.length} - expecting ${this.initialTopicCount}`)
        return topic
    }

    public removeTopic(id: string) {
        const topics = this.unconfirmedTopics
        for (let i = 0; i < topics.length; i++) {
            if (topics[i].id === id) {
                this.unconfirmedTopics = this.unconfirmedTopics.splice(i, 1)
                this.onModifiedTopic()
            }
        }
    }

    async waitForForums() {
        if (this.topics.length === 0) {
            return
        }

        console.log('Waiting for Topic Forums to sync...')

        for (let i = 0; i < this.topics.length; i++) {
            if (!this.topics[i].forum!.synced.isFulfilled()) {
                console.log(`Forum ${this.topics[i].forumAddress} isFulfilled ${this.topics[i].forum!.synced.isFulfilled()}`)
            }
        }

        await Promise.all(this.topics.map(t => t.forum!.synced))
    }

    onModifiedTopic(topic?: Topic) {

        if (this.notifications.server && this.ready.isFulfilled()) {
            // this.notifications.server.emit('NewTopic', topic ? topic.modelGET() : null)

            this.notifications.clients.forEach(client => {

                client.emit('NewTopic', topic ? topic.modelGET() : null)
            })
        }
    }

    public getTopic(id : string) : Topic {
        return this.topics.filter(t => t.id === id)[0]
    }
}

