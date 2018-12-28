import cors from 'cors'

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { AppController } from './app.controller';
import { AppService } from './app.service';
import NotificationsGateway from './notifications.gateway'

@Module({
    imports: [],
    providers: [AppService, NotificationsGateway],
    controllers: [AppController]
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer
            .apply(cors())
            .forRoutes(AppController);
    }
}
