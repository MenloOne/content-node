import BigNumber from 'bignumber.js'
import {
    OnGatewayConnection, OnGatewayDisconnect,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
    WsResponse,
} from '@nestjs/websockets'
import * as WebSocket from 'socket.io'

import { Observable } from 'rxjs'


export interface INewTopicEvent {
    forum: BigNumber | string
    topicHash: string
}

export interface IEvent {
    event: string
    NewTopic?: INewTopicEvent
}

@WebSocketGateway({
    origin: '*'
})
class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() public server;
    public clients: WebSocket.Socket[] = []

    constructor() {
        console.log('Starting Websocket')
    }

    handleConnection(client) {
        this.clients.push(client)
    }

    handleDisconnect(client) {
        for ( let i = 0; i < this.clients.length; i++) {
            if (this.clients[i] === client) {
                this.clients = this.clients.splice(i, 1)
                return
            }
        }
    }

    @SubscribeMessage('events')
    onEvents(client, data: string): Observable<WsResponse<IEvent>> {
        console.log('onEvents: ', data)

        // client.emit('NewTopic', { _topicHash: 'ksjdfksjdf' })

        const observable = Observable.create()
        return observable
    }
}

export default NotificationsGateway
