export class Timeout {
    message: string | null = null

    constructor(message) {
        this.message = message
    }
}

export interface ITimeout {
    ms: number
    error: string
}

export default class PromiseRaceSuccess {

    errors: any[] = []

    async timeout<T>(ms: number, promises: Promise<T>[]): Promise<T>;
    async timeout<T>(timeout: ITimeout, promises: Promise<T>[]): Promise<T>;

    async timeout<T>(_t: ITimeout | number, promises: Promise<T>[]): Promise<T> {
        let timeoutInfo : ITimeout
        if (typeof _t === 'number') {
            timeoutInfo = { ms: _t, error: `Error: Timed out in ${_t}ms` }
        } else {
            timeoutInfo = _t
        }

        const totalPromises = promises.length
        let timerResolve

        const timeout = new Promise<T>((resolve, reject) => {
            timerResolve = resolve
            setTimeout(() => reject(new Timeout(timeoutInfo.error)), timeoutInfo.ms)
        })

        return await Promise.race([timeout, Promise.race(promises.map(p => {
            return new Promise<T>(async (resolve, reject) => {
                try {
                    const result = await p
                    resolve(result)
                    timerResolve(result)
                } catch (e) {
                    this.errors.push(e)
                    if (this.errors.length === totalPromises) {
                        reject(this.errors)
                    }
                }
            })
        }))])
    }
}

