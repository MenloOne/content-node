import { Get, Param, Query, Controller, Post, Body } from '@nestjs/common'
import { AppService } from './app.service';
import { CNResult, ForumCTOGet, MessageCTOPost, TopicCTOPost, TopicsCTOGet } from './ContentNode/BlockOverflow.cto'

@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Get()
    async root(): Promise<string> {
        return await this.appService.version();
    }

    @Get('/v0/topics') // ?query=dude&pageLimit=20
    async topics(@Query() query): Promise<TopicsCTOGet> {
        if (query.continuation) {
            return this.appService.topicsNext(query.continuation)
        }

        return this.appService.topics(query.query, query.pageLimit)
    }

    @Post('/v0/topics')
    async createTopic(@Body('topic') topic: TopicCTOPost) : Promise<CNResult> {
        await this.appService.createTopic(topic)
        return { success: true }
    }

    @Get('/v0/forums/:address')
    async forum(@Param('address') address: string): Promise<ForumCTOGet> {
        return this.appService.forum(address)
    }

    @Post('/v0/forums/:address/messages')
    async createForum(@Param('address') address: string, @Body('message') message: MessageCTOPost) : Promise<CNResult> {
        await this.appService.createMessage(address, message)
        return { success: true }
    }
}
