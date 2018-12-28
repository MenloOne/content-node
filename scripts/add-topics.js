const readline = require('readline');
const fs = require('fs');

var MenloTopics = artifacts.require("./MenloTopics.sol");

module.exports = function() {
    go()
}

async function go() {
    const FILENAME = 'topics.out'

    try {
        let topics = await MenloTopics.at(MenloTopics.address)

        console.log('Reading _topics')
        console.log('Topics @ ', MenloTopics.address)
        console.log('Cost ', (await topics.topicCost()).toNumber() / 10 ** 18 )

        const file  = fs.readFileSync(FILENAME).toString()
        const lines = file.split('\n')

        lines.forEach(async (line) => {
            try {
                let [forum, topicHash] = line.split(',');
                if (forum.length != 42) { return }

                console.log('Read ', forum, topics.forums)
                const existingForum = await topics.forums.call(forum);
                console.log('Existing ', existingForum);

                if (!existingForum) {
                    console.log('Creating Topic @ ', forum, ' H ', topicHash);
                    let result = await topics.addForum(forum, topicHash);
                    console.log(result)
                }
            } catch (e) {
                console.log(e)
            }
        })

        process.exit()
    } catch (e) {
        throw(e)
    }
}
