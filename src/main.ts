import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { IoAdapter } from '@nestjs/websockets'
import https from 'https'


// Global outgoing HTTP concurrent request limit
https.globalAgent.maxSockets = 20


async function bootstrap() {
    const app = await NestFactory.create(AppModule)
    app.enableCors({
        origin: '*'
    })
    app.useWebSocketAdapter(new IoAdapter(app.getHttpServer()))

    const port = process.env.PORT || 8080;
    console.log(`API Service listening on ${port}`)
    await app.listen(port);
}
bootstrap();
