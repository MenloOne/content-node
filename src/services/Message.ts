import { Forum } from "./Forum";
import { IPFSMessage } from "../storage/RemoteIPFSStorage";
import { CID, MessageCTOGet, MessageCTOPost } from '../ContentNode/BlockOverflow.cto'


export default class Message extends IPFSMessage {

    public forum: Forum

    public id: CID
    public parent: CID

    public children: string[] = []
    public votes: number = 0
    public ethTransaction: string | null = null
    public filled: boolean
    public confirmed: boolean
    public error?: Error | null

    constructor(forum: Forum, message: MessageCTOPost | null, id?: CID, parent?: CID, offset?: number) {
        super()

        this.forum = forum

        if (message) {
            this.id      = message.id
            this.parent  = message.parent
            this.body    = message.body
            this.version = message.version
            this.offset  = message.offset
            this.topic   = message.topic
            this.parent  = message.parent
            this.author  = message.author
            this.date    = message.date
            this.body    = message.body
            this.ethTransaction = message.transaction
            this.filled  = true
            this.confirmed = false

        } else {
            this.id = id

            // IPFS Message
            this.parent  = parent
            this.offset  = offset!
            this.body = ''
            this.filled = false
            this.confirmed = true
        }
    }

    modelGET(): MessageCTOGet {
        return {
            id:       this.id,
            topic:    this.topic,
            version:  this.version,
            parent:   this.parent,
            offset:   this.offset,
            author:   this.author,
            date:     this.date,
            body:     this.body,
            votes:    this.votes,
            confirmed: this.confirmed,
            forumAddress: this.forum.contractAddress,
            children: this.confirmed ? this.children.map(id => this.forum.messages.get(id).modelGET()) : [],
        }
    }
}

